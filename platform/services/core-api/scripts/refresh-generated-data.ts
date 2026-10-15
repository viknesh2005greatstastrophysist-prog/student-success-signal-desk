/**
 * Data refresh "realistic-v2": regenerates the generated project records (marks,
 * LMS, internships and placements, fees, mentor split) with realistic, uneven,
 * correlated values. Deterministic: the same seed and as-of time give the same data.
 *
 *   tsx scripts/refresh-generated-data.ts --env <environment.json> <command> [options]
 *
 * Commands
 *   plan       print the plan summary, write nothing
 *   apply      apply migration 011, then the refresh in one transaction (additive)
 *   supersede  mark open drafts computed on the previous data as superseded
 *   policy     approve the graded-scoring policy version for each mentor
 *   stats      measure the live data: per-course marks, risk histograms, fees, loads
 *   candidates list students per mentor with their graded risk signals (to choose drafts)
 *   att-plan   realistic-v3: print the attendance plan (anchors, courses, sessions), write nothing
 *   att-apply  realistic-v3: rebuild the generated attendance from the college attendance report (additive)
 *   consistency-audit   read only: count every stored artifact by the data generation it was computed on
 *   consistency-plans   withdraw approved plans on earlier figures (audited outcome command); --dry-run counts only
 *   consistency-risk    recompute every student's risk on the current data (deterministic, no model call); --dry-run counts only
 *   att-supersede  realistic-v3: mark open drafts computed on the old attendance as superseded
 *   att-stats  measure the live attendance: anchor coverage, per-course mean and SD, shape, distance from the anchor
 *   drafts     run the real agent pipeline (Groq first) for chosen students, one plan per
 *              --group "<mentor-email>|<academic|attendance|wellbeing-referral>|<register>,<register>"
 *
 * Options
 *   --as-of <ISO>            reference time (default: the current hour, UTC)
 *   --exclude-email <email>  a student no step may touch (repeatable)
 *   --exclude-case <prefix>  the student owning this case is excluded (repeatable)
 *   --out <file>             also write the JSON result here
 *
 * The environment file is loaded into this process only; no connection detail is printed.
 */
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const many = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
const command = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
const envFile = flag("--env");
if (!envFile || !command) throw new Error("Usage: refresh-generated-data.ts --env <environment.json> <plan|apply|supersede|policy|stats>");
const env = JSON.parse(await readFile(envFile, "utf8")) as Record<string, string>;
Object.assign(process.env, env);
const url = new URL(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "");
const hosted = process.env.CORE_DATABASE_SCHEMA === "aura_hosted_project_core";
const local = process.env.CORE_DATABASE_SCHEMA === "aura_project_core";
if (local && (url.hostname !== "127.0.0.1" || url.port !== "55432")) throw new Error("The local project schema must be on the local database");
if (hosted && ["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The hosted project schema must be on the hosted database");
if (!local && !hosted) throw new Error("Only aura_project_core and aura_hosted_project_core may be refreshed");
if (hosted) (process.env as Record<string, string>).NODE_ENV = "production";
if (command === "drafts") {
  // Model credentials for the live pipeline come from the git-ignored root .env, in this process only.
  const dotenv = await readFile(new URL("../../../../.env", import.meta.url), "utf8");
  for (const line of dotenv.split("\n")) {
    const m = line.match(/^(GROQ_API_KEY|GEMINI_API_KEY)=(.*)$/);
    if (m) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  process.env.CH11_PROVIDER_ORDER ??= "groq,gemini,configured";
  process.env.CH11_LIMITER_MAX_WAIT_MS ??= "65000";
}
// Count (never log) outbound model requests so a call budget can be enforced.
const modelCalls = { groq: 0, gemini: 0, other: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url).hostname;
  if (host.endsWith("groq.com")) modelCalls.groq += 1;
  else if (host.endsWith("googleapis.com")) modelCalls.gemini += 1;
  else if (!["127.0.0.1", "localhost"].includes(host)) modelCalls.other += 1;
  return realFetch(input, init);
}) as typeof fetch;

const { withCoreTransaction, withCoreSnapshot, closePool } = await import("../lib/db");
const { migrateCoreDatabase } = await import("../lib/migrations");
const { REFRESH_LABEL, REFRESH_SEED, planRefresh, projectId, histogram } = await import("../lib/data-refresh/generator");
const { loadRefreshInput, applyRefresh, supersedeStaleDrafts, resolveStudentIds } = await import("../lib/data-refresh/apply");
const { ATTENDANCE_LABEL, ATTENDANCE_SEED, planAttendance } = await import("../lib/data-refresh/attendance");
const { loadAttendanceInput, applyAttendanceRefresh, loadAnchors } = await import("../lib/data-refresh/attendance-apply");
const { approvePolicy } = await import("../lib/chapter11/service");
const { routeSpecialist } = await import("../lib/chapter11/specialists");
const { demoPolicy, riskAnalysis, policySchema } = await import("../lib/chapter11/engine");
type Policy = import("../lib/chapter11/engine").Policy;
const { readSource } = await import("../lib/chapter11/service");
const { getCurrentGeneration } = await import("../lib/command-ledger");
const { auditStaleArtifacts, withdrawStalePlans, recomputeRiskAnalyses } = await import("../lib/data-refresh/consistency");

const hour = 3600000;
const asOf = flag("--as-of") ?? new Date(Math.floor(Date.now() / hour) * hour).toISOString();
const out = flag("--out");
const emit = async (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  console.log(text);
  if (out) await writeFile(out, text + "\n", { mode: 0o600 });
};

async function excluded(): Promise<string[]> {
  const ids = new Set<string>();
  await withCoreTransaction(async (c) => {
    for (const email of many("--exclude-email")) for (const id of await resolveStudentIds(c, { email })) ids.add(id);
    for (const caseIdPrefix of many("--exclude-case")) for (const id of await resolveStudentIds(c, { caseIdPrefix })) ids.add(id);
  });
  return [...ids];
}
const loadInput = async () => {
  const exclude = await excluded();
  const input = await withCoreSnapshot((c) => loadRefreshInput(c, { asOf, label: REFRESH_LABEL, seed: REFRESH_SEED, excludeStudentIds: exclude }));
  return { input, exclude };
};

async function stats() {
  const exclude = await excluded();
  const generation = await withCoreSnapshot((c) => getCurrentGeneration(c));
  const sql = async <T extends object>(text: string, params: unknown[] = []) =>
    withCoreSnapshot(async (c) => (await c.query(text, params)).rows as T[]);
  const marks = await sql<{ code: string; n: string; mean: string; sd: string; p_lt40: string; p_55_80: string; p_ge90: string }>(
    `SELECT cc.code,count(*)::text n,round(avg(pct)::numeric,1)::text mean,round(stddev_pop(pct)::numeric,1)::text sd,
       round(100.0*avg((pct<40)::int),1)::text p_lt40,round(100.0*avg((pct>=55 AND pct<80)::int),1)::text p_55_80,round(100.0*avg((pct>=90)::int),1)::text p_ge90
     FROM (SELECT a.course_offering_id,(m.score/a.maximum_score*100)::float pct FROM marks m JOIN assessments a ON a.id=m.assessment_id WHERE m.generation_id=$1 AND a.published AND m.student_id<>ALL($2::uuid[])) x
     JOIN course_offerings o ON o.id=x.course_offering_id JOIN courses cc ON cc.id=o.course_id GROUP BY cc.code ORDER BY cc.code`,
    [generation, exclude],
  );
  const results = await sql<{ code: string; mean: string; sd: string }>(
    `SELECT cc.code,round(avg(r.percentage)::numeric,1)::text mean,round(stddev_pop(r.percentage)::numeric,1)::text sd FROM course_results r JOIN course_offerings o ON o.id=r.course_offering_id JOIN courses cc ON cc.id=o.course_id
     WHERE r.generation_id=$1 AND r.student_id<>ALL($2::uuid[]) GROUP BY cc.code ORDER BY cc.code`, [generation, exclude]);
  const fees = await sql<{ state: string; n: string }>(
    `SELECT CASE WHEN i.status='paid' THEN 'paid' WHEN i.status='partial' THEN 'partly paid' WHEN i.due_on<now()::date THEN 'unpaid and overdue' ELSE 'unpaid, not yet due' END state,count(*)::text n
     FROM fee_invoices i WHERE i.generation_id=$1 AND i.status<>'void' AND i.invoice_number LIKE 'FEE-26ODD-%-T' GROUP BY 1 ORDER BY 1`, [generation]);
  const feeAll = await sql<{ status: string; n: string; min_amount: string; max_amount: string }>(
    "SELECT status,count(*)::text n,min(amount_paise/100)::text min_amount,max(amount_paise/100)::text max_amount FROM fee_invoices WHERE generation_id=$1 GROUP BY status ORDER BY status", [generation]);
  const loads = await sql<{ mentor: string; n: string }>(
    "SELECT p.display_name mentor,count(*)::text n FROM mentor_assignments m JOIN people p ON p.id=m.faculty_person_id WHERE m.generation_id=$1 GROUP BY 1 ORDER BY 1", [generation]);
  const careers = await sql<{ source: string; semester: string; state: string; missed: string; n: string }>(
    `SELECT x.source,s.semester::text,x.record->>'state' state,coalesce(x.record->'values'->>'missedMilestones',x.record->'values'->>'missedActivities') missed,count(*)::text n
     FROM ch11_sources x JOIN student_profiles s ON s.id=x.student_id WHERE x.generation_id=$1 AND x.source IN ('internship','placement') GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`, [generation]);
  const checksums = await sql<{ review_md5: string; attendance_md5: string; attendance_rows: string }>(
    `SELECT (SELECT md5(review::text) FROM project_dataset WHERE id=$1) review_md5,
       (SELECT md5(string_agg(s.register_number||'|'||cc.code||'|'||ses.session_date::text||'|'||r.status,E'\\n' ORDER BY s.register_number,cc.code,ses.session_date))
          FROM attendance_records r JOIN attendance_sessions ses ON ses.id=r.attendance_session_id JOIN student_profiles s ON s.id=r.student_id
          JOIN course_offerings o ON o.id=ses.course_offering_id JOIN courses cc ON cc.id=o.course_id WHERE r.generation_id=$1) attendance_md5,
       (SELECT count(*)::text FROM attendance_records WHERE generation_id=$1) attendance_rows`, [generation]);
  const lateSubs = await sql<{ n: string; late: string }>(
    `SELECT count(*)::text n,count(*) FILTER (WHERE s.submitted_at>a.due_at)::text late FROM lms_submissions s JOIN lms_assignments a ON a.id=s.assignment_id WHERE s.generation_id=$1 AND s.student_id<>ALL($2::uuid[])`, [generation, exclude]);
  const gens = await sql<{ label: string; as_of: string }>("SELECT label,as_of::text FROM data_generations WHERE generation_id=$1 ORDER BY created_at", [generation]).catch(() => []);
  const rows = await riskRows(generation);
  const live = rows.filter((r) => !exclude.includes(r.id));
  const scoresFixed = live.map((r) => r.fixed.score), scoresGraded = live.map((r) => r.graded.score);
  const inactivity = live.map((r) => r.ev.lms.values.inactivityDays!), overdue = live.map((r) => r.ev.lms.values.overdueAssignments!);
  const attendancePct = live.map((r) => r.ev.academic.values.attendancePct!), markPct = live.map((r) => r.ev.academic.values.markPct!);
  const failed = 0;
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const distinct = (xs: number[]) => new Set(xs).size;
  return {
    asOf, schema: process.env.CORE_DATABASE_SCHEMA, dataGenerations: gens,
    attendanceBasisLabelled: live.filter((r) => (r.ev.academic.values as Record<string, unknown>).attendanceBasis === "college_attendance_report").length,
    excludedStudents: exclude.length,
    marksByCourse: marks, resultsByCourse: results, submissions: lateSubs[0],
    fees: { tuitionStudentState: fees, invoicesByStatus: feeAll },
    mentorLoads: loads, careers,
    realAttendance: checksums[0],
    risk: {
      students: scoresFixed.length, evidenceFailures: failed,
      fixedHistogram: histogram(scoresFixed, bins), gradedHistogram: histogram(scoresGraded, bins),
      distinctScores: { fixed: distinct(scoresFixed), graded: distinct(scoresGraded) },
      inactivityDays: histogram(inactivity, [0, 1, 2, 3, 4, 5, 7, 10, 14, 20]),
      overdueAssignments: histogram(overdue, [0, 1, 2, 3]),
      attendancePct: histogram(attendancePct.map((x) => Math.round(x)), [0, 40, 50, 60, 70, 75, 80, 90, 100]),
      markPct: histogram(markPct.map((x) => Math.round(x)), [0, 30, 40, 50, 60, 70, 80, 90]),
    },
  };
}


type RiskRow = { id: string; register: string; mentorEmail: string; semester: number; ev: Record<string, { values: Record<string, number> }>; fixed: ReturnType<typeof riskAnalysis>; graded: ReturnType<typeof riskAnalysis> };
async function riskRows(generation: string): Promise<RiskRow[]> {
  const people = await withCoreSnapshot(async (c) => (await c.query<{ student_id: string; register: string; semester: number; mentor_email: string; hod: string; hod_subject: string; department_id: string }>(
    `SELECT s.id student_id,s.register_number register,s.semester,mp.email mentor_email,h.person_id hod,hp.external_subject hod_subject,s.department_id
     FROM student_profiles s JOIN mentor_assignments m ON m.student_id=s.id AND m.generation_id=s.generation_id JOIN people mp ON mp.id=m.faculty_person_id
     JOIN LATERAL (SELECT r.person_id FROM role_assignments r WHERE r.generation_id=s.generation_id AND r.role='hod' AND r.active ORDER BY r.person_id LIMIT 1) h ON true
     JOIN people hp ON hp.id=h.person_id WHERE s.generation_id=$1 ORDER BY s.register_number`, [generation])).rows);
  const fixed: Policy = policySchema.parse({ ...demoPolicy, version: "PROJECT-SUPPORT-V1" });
  const graded: Policy = policySchema.parse({ ...demoPolicy, version: "PROJECT-SUPPORT-V2", severity: "graded" });
  const actor = { subject: people[0]!.hod_subject, personId: people[0]!.hod, role: "hod" as const, departmentId: people[0]!.department_id };
  const out: RiskRow[] = [];
  let index = 0;
  const worker = async () => {
    while (index < people.length) {
      const row = people[index++]!;
      const evidence = Object.fromEntries(await Promise.all((["academic", "lms", "internship", "placement"] as const).map(async (name) => [name, await readSource(actor, row.student_id, name)]))) as never;
      out.push({ id: row.student_id, register: row.register, mentorEmail: row.mentor_email, semester: row.semester, ev: evidence, fixed: riskAnalysis(evidence, fixed), graded: riskAnalysis(evidence, graded) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out.sort((a, b) => a.register.localeCompare(b.register));
}

async function candidates() {
  const exclude = await excluded();
  const generation = await withCoreSnapshot((c) => getCurrentGeneration(c));
  const keep = new Set((await withCoreSnapshot(async (c) => (await c.query<{ id: string }>(
    "SELECT DISTINCT student_id id FROM support_cases WHERE generation_id=$1 AND status IN ('approved','awaiting_faculty')", [generation])).rows)).map((r) => r.id));
  const rows = (await riskRows(generation)).filter((r) => !exclude.includes(r.id) && !keep.has(r.id) && r.graded.flagged);
  const by: Record<string, Array<Record<string, unknown>>> = {};
  for (const r of rows) {
    const route = routeSpecialist(r.graded.signals, "academic");
    (by[r.mentorEmail] ??= []).push({ register: r.register, sem: r.semester, score: r.graded.score, band: r.graded.band, route, signals: r.graded.signals.map((s) => `${s.code}:${s.points}`).join(" "), att: Math.round(r.ev.academic.values.attendancePct!), mark: Math.round(r.ev.academic.values.markPct!), idle: r.ev.lms.values.inactivityDays, overdue: r.ev.lms.values.overdueAssignments });
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.sort((a, b) => (b.score as number) - (a.score as number))]));
}

async function drafts() {
  const { savePlan, lockPlan, executePlan, exportPlan } = await import("../lib/chapter11/service");
  const { configuredComposer } = await import("../lib/chapter11/provider");
  const composer = configuredComposer();
  if (!composer) throw new Error("No AI model is configured");
  const report: Array<Record<string, unknown>> = [];
  const budget = Number(flag("--budget") ?? 45);
  for (const group of many("--group")) {
    if (modelCalls.groq >= budget) { console.error(JSON.stringify({ stopped: "call budget reached", ...modelCalls })); break; }
    const [mentorEmail, domain, registers] = group.split("|");
    const info = await withCoreSnapshot(async (c) => {
      const gen = await getCurrentGeneration(c);
      const m = (await c.query<{ id: string; subject: string; department_id: string }>(
        `SELECT p.id,p.external_subject subject,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND p.email=$2 AND r.role='faculty'`, [gen, mentorEmail])).rows[0]!;
      const st = (await c.query<{ id: string; register: string }>(
        `SELECT s.id,s.register_number register FROM student_profiles s JOIN mentor_assignments a ON a.student_id=s.id WHERE s.generation_id=$1 AND s.register_number=ANY($2::text[]) AND a.faculty_person_id=$3`, [gen, registers!.split(","), m.id])).rows;
      return { m, st };
    });
    if (info.st.length !== registers!.split(",").length) throw new Error("Every chosen student must be a mentee of the chosen mentor");
    if ((await excluded()).some((id) => info.st.some((s) => s.id === id))) throw new Error("Student 021 is never used");
    const actor = { subject: info.m.subject, personId: info.m.id, role: "faculty" as const, departmentId: info.m.department_id };
    const policyId = projectId(REFRESH_SEED, `policy:PROJECT-SUPPORT-V2:${info.m.id}`);
    const resume = flag("--resume-plan");
    const plan = resume ? { id: resume, status: "locked", revision: 0 } : await savePlan(actor, {
      request: `Post data-refresh review (${ATTENDANCE_LABEL}): prepare support options for these ${info.st.length} students from the refreshed figures and the approved graded policy.`,
      studentIds: info.st.map((s) => s.id), domain, policyId, feedback: "Use scoped evidence only; keep every number traceable to the evidence and require mentor review.",
    });
    const locked = plan.status === "locked" ? plan : await lockPlan(actor, plan.id, plan.revision);
    void locked;
    let statuses: Record<string, number> = {};
    for (let round = 0; round < 20; round++) {
      await executePlan(actor, plan.id, { concurrency: 1, composer });
      const output = await exportPlan(actor, plan.id);
      statuses = {};
      for (const job of output.jobs as Array<{ status: string }>) statuses[job.status] = (statuses[job.status] ?? 0) + 1;
      console.error(JSON.stringify({ plan: plan.id.slice(0, 8), round, statuses }));
      if (!statuses.queued && !statuses.running) break;
    }
    const cases = await withCoreSnapshot(async (c) => (await c.query<{ id: string; register: string; status: string; band: string; model_calls: string }>(
      `SELECT sc.id,s.register_number register,sc.status,sc.risk_band band,
         coalesce((SELECT sum((a.content->'agent'->>'modelCalls')::int) FROM agent_runs r JOIN agent_artifacts a ON a.agent_run_id=r.id WHERE r.support_case_id=sc.id),0)::text model_calls
       FROM ch11_jobs j JOIN support_cases sc ON sc.id=j.support_case_id JOIN student_profiles s ON s.id=j.student_id WHERE j.plan_id=$1 ORDER BY s.register_number`, [plan.id])).rows).catch(() => []);
    report.push({ mentor: mentorEmail, domain, callsSoFar: { ...modelCalls }, planId: plan.id, students: info.st.length, statuses, cases: cases.map((x) => ({ case: x.id.slice(0, 8), register: x.register, status: x.status, band: x.band })) });
  }
  return [...report, { modelCalls }];
}

const loadAttendance = async () => {
  const exclude = await excluded();
  const input = await withCoreSnapshot((c) => loadAttendanceInput(c, { asOf, label: ATTENDANCE_LABEL, seed: ATTENDANCE_SEED, excludeStudentIds: exclude }));
  return { input, exclude };
};

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const stat = (xs: number[]) => {
  const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const s = [...xs].sort((a, b) => a - b), at = (p: number) => s[Math.min(n - 1, Math.floor(p * n))]!;
  return { n, mean: r1(mean), sd: r1(sd), min: r1(s[0]!), p10: r1(at(0.1)), median: r1(at(0.5)), p90: r1(at(0.9)), max: r1(s[n - 1]!) };
};

/** Attendance as the app derives it (present or late over everything not excused), per course, against the college anchor. */
async function attStats() {
  const exclude = await excluded();
  const generation = await withCoreSnapshot((c) => getCurrentGeneration(c));
  const sql = async <T extends object>(text: string, params: unknown[] = []) => withCoreSnapshot(async (c) => (await c.query(text, params)).rows as T[]);
  const rows = await sql<{ student_id: string; code: string; att: string; held: string; total: string }>(
    `SELECT r.student_id,cc.code,count(*) FILTER (WHERE r.status IN ('present','late'))::text att,count(*) FILTER (WHERE r.status<>'excused')::text held,count(*)::text total
     FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id JOIN course_offerings o ON o.id=s.course_offering_id JOIN courses cc ON cc.id=o.course_id
     WHERE r.generation_id=$1 AND s.status IN ('submitted','locked') AND r.student_id<>ALL($2::uuid[]) GROUP BY 1,2`, [generation, exclude]);
  const anchors = await withCoreSnapshot((c) => loadAnchors(c, generation));
  const marks = await sql<{ student_id: string; code: string; pct: string }>(
    `SELECT r.student_id,cc.code,r.percentage::text pct FROM course_results r JOIN course_offerings o ON o.id=r.course_offering_id JOIN courses cc ON cc.id=o.course_id
     WHERE r.generation_id=$1 AND r.student_id<>ALL($2::uuid[])`, [generation, exclude]);
  const counts = (await sql<{ sessions: string; records: string; per_course: string; gens: string }>(
    `SELECT (SELECT count(*) FROM attendance_sessions WHERE generation_id=$1)::text sessions,(SELECT count(*) FROM attendance_records WHERE generation_id=$1)::text records,
       (SELECT string_agg(code||'='||n,', ') FROM (SELECT cc.code,count(*) n FROM attendance_sessions s JOIN course_offerings o ON o.id=s.course_offering_id JOIN courses cc ON cc.id=o.course_id WHERE s.generation_id=$1 GROUP BY 1 ORDER BY 1) x) per_course,
       (SELECT string_agg(label,' > ' ORDER BY created_at) FROM data_generations WHERE generation_id=$1) gens`, [generation]))[0]!;
  const pct = (r: { att: string; held: string }) => (Number(r.held) ? (Number(r.att) / Number(r.held)) * 100 : 0);
  const codes = [...new Set(rows.map((r) => r.code))].sort();
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const perCourse: Record<string, unknown> = {};
  for (const code of codes) {
    const xs = rows.filter((r) => r.code === code).map(pct);
    perCourse[code] = {
      ...stat(xs), distinctValues: new Set(xs.map((x) => Math.round(x * 100))).size,
      at100: xs.filter((x) => x >= 99.995).length, below75: xs.filter((x) => x < 75).length, below50: xs.filter((x) => x < 50).length,
      histogram: histogram(xs.map((x) => Math.min(99, Math.floor(x))), bins.slice(0, 10)),
    };
  }
  const students = [...new Set(rows.map((r) => r.student_id))];
  const overall = students.map((id) => {
    const mine = rows.filter((r) => r.student_id === id);
    const held = mine.reduce((a, r) => a + Number(r.held), 0);
    return held ? (mine.reduce((a, r) => a + Number(r.att), 0) / held) * 100 : 0;
  });
  const withAnchor = students.map((id, i) => ({ id, overall: overall[i]!, anchor: anchors.get(id)?.anchor ?? null })).filter((x) => x.anchor !== null);
  const gap = withAnchor.map((x) => x.overall - x.anchor!);
  const markMean = (id: string) => { const m = marks.filter((x) => x.student_id === id); return m.length ? m.reduce((a, x) => a + Number(x.pct), 0) / m.length : NaN; };
  const paired = students.map((id, i) => ({ a: overall[i]!, m: markMean(id) })).filter((x) => Number.isFinite(x.m));
  const byCourseMarkCorr: Record<string, number> = {};
  for (const code of codes) {
    const p = rows.filter((r) => r.code === code).map((r) => ({ a: pct(r), m: Number(marks.find((m) => m.student_id === r.student_id && m.code === code)?.pct ?? NaN) })).filter((x) => Number.isFinite(x.m));
    byCourseMarkCorr[code] = pearson(p.map((x) => x.a), p.map((x) => x.m));
  }
  const anchorVals = [...anchors.values()];
  return {
    asOf, schema: process.env.CORE_DATABASE_SCHEMA, dataGenerations: counts.gens,
    sessions: Number(counts.sessions), records: Number(counts.records), sessionsPerCourse: counts.per_course, studentsMeasured: students.length, excludedStudents: exclude.length,
    anchorCoverage: {
      studentsInCollegeData: anchors.size, withUsableValue: anchorVals.filter((a) => a.anchor !== null).length,
      usableCells: anchorVals.reduce((a, x) => a + x.cells, 0), outOfRangeCells: anchorVals.reduce((a, x) => a + x.outOfRange, 0),
      anchor: stat(anchorVals.filter((a) => a.anchor !== null).map((a) => a.anchor!)),
    },
    perCourse, overall: { ...stat(overall), histogram: histogram(overall.map((x) => Math.min(99, Math.floor(x))), bins.slice(0, 10)) },
    overallVsAnchor: {
      students: withAnchor.length, meanDifference: r1(gap.reduce((a, b) => a + b, 0) / gap.length),
      meanAbsDifference: r1(gap.reduce((a, b) => a + Math.abs(b), 0) / gap.length),
      within5: gap.filter((g) => Math.abs(g) <= 5).length, within10: gap.filter((g) => Math.abs(g) <= 10).length,
      correlation: pearson(withAnchor.map((x) => x.overall), withAnchor.map((x) => x.anchor!)),
    },
    marksCorrelation: { overallAttendanceVsMeanMark: pearson(paired.map((x) => x.a), paired.map((x) => x.m)), perCourse: byCourseMarkCorr },
  };
}


async function policy() {
  const created: Array<{ mentor: string; id: string; version: string }> = [];
  const mentors = await withCoreSnapshot(async (c) => {
    const gen = await getCurrentGeneration(c);
    return (await c.query<{ id: string; subject: string; department_id: string; name: string }>(
      `SELECT p.id,p.external_subject subject,r.department_id,p.display_name name FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id
       WHERE p.generation_id=$1 AND r.role='faculty' AND r.active ORDER BY p.email`, [gen])).rows;
  });
  for (const m of mentors) {
    const actor = { subject: m.subject, personId: m.id, role: "faculty" as const, departmentId: m.department_id };
    const id = projectId(REFRESH_SEED, `policy:PROJECT-SUPPORT-V2:${m.id}`);
    const exists = await withCoreSnapshot(async (c) => (await c.query("SELECT 1 FROM ch11_policies WHERE id=$1", [id])).rowCount);
    if (!exists)
      await approvePolicy(actor, {
        policy: { ...demoPolicy, version: "PROJECT-SUPPORT-V2", severity: "graded" },
        rationale: "Same faculty-set thresholds and weights as PROJECT-SUPPORT-V1. Points now scale with how far a value is beyond its threshold, so risk scores spread instead of bunching. Approved by the mentor account under the project owner's authorisation; not an institutional approval.",
      }, id);
    created.push({ mentor: m.name, id: id.slice(0, 8), version: "PROJECT-SUPPORT-V2" });
  }
  return created;
}

try {
  if (command === "plan") {
    const { input, exclude } = await loadInput();
    const plan = planRefresh(input);
    await emit({ asOf, excluded: exclude.length, summary: plan.summary });
  } else if (command === "apply") {
    await migrateCoreDatabase();
    const { input, exclude } = await loadInput();
    const plan = planRefresh(input);
    const result = await withCoreTransaction((c) => applyRefresh(c, input, plan), "exclusive");
    await emit({ asOf, excluded: exclude.length, ...result });
  } else if (command === "supersede") {
    const { input, exclude } = await loadInput();
    const result = await withCoreTransaction((c) => supersedeStaleDrafts(c, { label: REFRESH_LABEL, operatorId: input.operatorId, excludeStudentIds: exclude }), "exclusive");
    await emit(result);
  } else if (command === "policy") {
    await emit(await policy());
  } else if (command === "att-plan") {
    const { input, exclude } = await loadAttendance();
    const plan = planAttendance(input);
    await emit({ asOf, excluded: exclude.length, summary: plan.summary });
  } else if (command === "att-apply") {
    await migrateCoreDatabase();
    const { input, exclude } = await loadAttendance();
    const plan = planAttendance(input);
    const result = await withCoreTransaction((c) => applyAttendanceRefresh(c, input, plan), "exclusive");
    await emit({ asOf, excluded: exclude.length, ...result });
  } else if (command === "att-supersede") {
    const exclude = await excluded();
    const operatorId = await withCoreSnapshot(async (c) => (await c.query<{ id: string }>(
      "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='governance' AND r.active ORDER BY p.email LIMIT 1", [await getCurrentGeneration(c)])).rows[0]!.id);
    const result = await withCoreTransaction((c) => supersedeStaleDrafts(c, { label: ATTENDANCE_LABEL, seed: ATTENDANCE_SEED, operatorId, excludeStudentIds: exclude, reason: "superseded by attendance refresh (college attendance report)" }), "exclusive");
    await emit(result);
  } else if (command === "att-stats") {
    await emit(await attStats());
  } else if (command === "consistency-audit") {
    await emit(await withCoreSnapshot((c) => auditStaleArtifacts(c)));
  } else if (command === "consistency-plans") {
    await emit(await withdrawStalePlans({ excludeStudentIds: await excluded(), dryRun: args.includes("--dry-run") }));
  } else if (command === "consistency-risk") {
    const label = await withCoreSnapshot(async (c) => (await c.query<{ label: string }>("SELECT label FROM data_generations ORDER BY created_at DESC LIMIT 1")).rows[0]!.label);
    await emit(await recomputeRiskAnalyses({ label, excludeStudentIds: await excluded(), dryRun: args.includes("--dry-run") }));
  } else if (command === "stats") {
    await emit(await stats());
  } else if (command === "candidates") {
    await emit(await candidates());
  } else if (command === "drafts") {
    await emit(await drafts());
  } else throw new Error(`Unknown command ${command}`);
} finally {
  await closePool();
}
