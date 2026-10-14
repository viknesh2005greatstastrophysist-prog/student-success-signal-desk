/**
 * Reads the current records, applies a data-refresh plan and retires stale drafts.
 *
 * Everything is additive and audited:
 *  - nothing is deleted, no table is reset, the supplied college data
 *    (`project_dataset`) and the generated attendance records are not written;
 *  - every changed row keeps its whole previous image in the append-only
 *    `record_changes` table, so the old generated data stays for audit;
 *  - the refresh is recorded as a row in the append-only `data_generations` table
 *    (the latest row is the current data generation) and in the command ledger;
 *  - evidence snapshots, cases and decisions already recorded are not touched.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { digest } from "../chapter11/engine";
import { getCurrentGeneration, writeCommandLedger } from "../command-ledger";
import {
  projectId,
  type Plan,
  type RefreshInput,
  type RefreshStudent,
} from "./generator";

export type LoadOptions = {
  asOf: string;
  label: string;
  seed: string;
  /** Student ids that no refresh step may touch (student 021). */
  excludeStudentIds: string[];
};

const DAY = 86400000;

type Q = <T extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const q = (c: PoolClient): Q => async (sql, params) => (await c.query(sql, params)).rows as never;

export async function resolveStudentIds(c: PoolClient, opts: { email?: string; caseIdPrefix?: string }): Promise<string[]> {
  const gen = await getCurrentGeneration(c);
  const ids = new Set<string>();
  if (opts.email) {
    const r = await c.query<{ id: string }>(
      "SELECT s.id FROM student_profiles s JOIN people p ON p.id=s.person_id WHERE s.generation_id=$1 AND p.email=$2",
      [gen, opts.email],
    );
    for (const row of r.rows) ids.add(row.id);
  }
  if (opts.caseIdPrefix) {
    const r = await c.query<{ student_id: string }>(
      "SELECT student_id FROM support_cases WHERE generation_id=$1 AND id::text LIKE $2",
      [gen, `${opts.caseIdPrefix}%`],
    );
    for (const row of r.rows) ids.add(row.student_id);
  }
  return [...ids];
}

export async function loadRefreshInput(c: PoolClient, opts: LoadOptions): Promise<RefreshInput & { generation: string; operatorId: string; hodId: string }> {
  const query = q(c);
  const gen = await getCurrentGeneration(c);
  const asOfMs = Date.parse(opts.asOf);
  const [term] = await query<{ id: string }>("SELECT id FROM terms WHERE generation_id=$1 AND code='2026-ODD'", [gen]);
  if (!term) throw new Error("Term 2026-ODD not found");
  const mentors = await query<{ id: string }>(
    `SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id
     WHERE p.generation_id=$1 AND r.role='faculty' AND r.active ORDER BY p.email`,
    [gen],
  );
  const [operator] = await query<{ id: string }>(
    "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='governance' AND r.active ORDER BY p.email LIMIT 1",
    [gen],
  );
  const [hod] = await query<{ id: string }>(
    "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='hod' AND r.active ORDER BY p.email LIMIT 1",
    [gen],
  );
  if (!operator || !hod || mentors.length < 2) throw new Error("Governance, head of department and mentor accounts are required");
  const courses = await query<{ offering_id: string; code: string; faculty_id: string; assessment_id: string; assignment_id: string; lesson_id: string; due_at: Date }>(
    `SELECT o.id AS offering_id,c.code,
       (SELECT fa.faculty_person_id FROM faculty_assignments fa WHERE fa.course_offering_id=o.id AND fa.generation_id=$1 ORDER BY fa.faculty_person_id LIMIT 1) AS faculty_id,
       (SELECT a.id FROM assessments a WHERE a.course_offering_id=o.id AND a.generation_id=$1 AND a.title='Course assessment') AS assessment_id,
       (SELECT x.id FROM lms_assignments x WHERE x.course_offering_id=o.id AND x.generation_id=$1 ORDER BY x.created_at LIMIT 1) AS assignment_id,
       (SELECT l.id FROM lms_lessons l WHERE l.course_offering_id=o.id AND l.generation_id=$1 ORDER BY l.created_at LIMIT 1) AS lesson_id,
       (SELECT x.due_at FROM lms_assignments x WHERE x.course_offering_id=o.id AND x.generation_id=$1 ORDER BY x.created_at LIMIT 1) AS due_at
     FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND o.term_id=$2 ORDER BY c.code`,
    [gen, term.id],
  );
  if (courses.length !== 3 || courses.some((x) => !x.assessment_id || !x.assignment_id || !x.lesson_id || !x.faculty_id))
    throw new Error("Expected three offerings, each with a Course assessment, an assignment, a lesson and a teacher");

  const base = await query<{
    student_id: string; person_id: string; register: string; semester: number; mentor_id: string; parent_id: string | null;
    keep_mentor: boolean; keep_fees: boolean; last_activity: Date | null; invoice_id: string | null;
  }>(
    `SELECT s.id AS student_id,s.person_id,s.register_number AS register,s.semester,m.faculty_person_id AS mentor_id,
       (SELECT pl.parent_person_id FROM parent_links pl WHERE pl.student_id=s.id AND pl.generation_id=$1 AND pl.active ORDER BY pl.linked_at LIMIT 1) AS parent_id,
       (EXISTS(SELECT 1 FROM support_cases sc WHERE sc.student_id=s.id AND sc.status='approved')
        OR EXISTS(SELECT 1 FROM support_plans sp JOIN support_cases sc ON sc.id=sp.support_case_id WHERE sc.student_id=s.id)) AS keep_mentor,
       EXISTS(SELECT 1 FROM payment_transactions t JOIN fee_invoices i ON i.id=t.invoice_id WHERE i.student_id=s.id) AS keep_fees,
       (SELECT max(a.occurred_at) FROM lms_activity a WHERE a.student_id=s.id AND a.generation_id=$1) AS last_activity,
       (SELECT i.id FROM fee_invoices i WHERE i.student_id=s.id AND i.generation_id=$1 AND i.status<>'void' ORDER BY i.invoice_number LIMIT 1) AS invoice_id
     FROM student_profiles s JOIN mentor_assignments m ON m.student_id=s.id AND m.generation_id=s.generation_id
     WHERE s.generation_id=$1 ORDER BY s.register_number`,
    [gen],
  );
  // Supplied college data: section of the latest report and the mean of the numeric attendance cells.
  const supplied = await query<{ student_id: string; section: string; att: string | null }>(
    `SELECT st->>'id' AS student_id,
       (SELECT r->>'section' FROM jsonb_array_elements(st->'reports') r ORDER BY (r->>'semester')::int DESC LIMIT 1) AS section,
       (SELECT avg((c->>'value')::numeric) FROM jsonb_array_elements(st->'reports') r, jsonb_array_elements(r->'courses') c
          WHERE c->>'kind'='number' AND c->>'field' ILIKE '%attendance%')::text AS att
     FROM project_dataset d, jsonb_array_elements(d.review->'students') st WHERE d.id=$1`,
    [gen],
  );
  const sup = new Map(supplied.map((r) => [r.student_id, r]));
  const marks = await query<{ student_id: string; offering_id: string; id: string }>(
    "SELECT m.student_id,a.course_offering_id AS offering_id,m.id FROM marks m JOIN assessments a ON a.id=m.assessment_id WHERE m.generation_id=$1 AND a.title='Course assessment'", [gen]);
  const results = await query<{ student_id: string; offering_id: string; id: string }>(
    "SELECT student_id,course_offering_id AS offering_id,id FROM course_results WHERE generation_id=$1", [gen]);
  const subs = await query<{ student_id: string; assignment_id: string; id: string }>(
    "SELECT student_id,assignment_id,id FROM lms_submissions WHERE generation_id=$1", [gen]);
  const srcs = await query<{ student_id: string; source: "internship" | "placement"; id: string; record: Record<string, unknown> }>(
    "SELECT student_id,source,id,record FROM ch11_sources WHERE generation_id=$1 AND source IN ('internship','placement')", [gen]);

  const offeringOfAssignment = new Map(courses.map((x) => [x.assignment_id, x.offering_id]));
  const students: RefreshStudent[] = base.map((b) => {
    const s = sup.get(b.student_id);
    const baseMarkId: Record<string, string | undefined> = {};
    const resultId: Record<string, string | undefined> = {};
    const submissionId: Record<string, string | undefined> = {};
    for (const m of marks) if (m.student_id === b.student_id) baseMarkId[m.offering_id] = m.id;
    for (const r of results) if (r.student_id === b.student_id) resultId[r.offering_id] = r.id;
    for (const x of subs) if (x.student_id === b.student_id) { const o = offeringOfAssignment.get(x.assignment_id); if (o) submissionId[o] = x.id; }
    const mine = srcs.filter((x) => x.student_id === b.student_id);
    const pick = (source: string) => { const row = mine.find((x) => x.source === source); return row ? { id: row.id, record: row.record } : null; };
    return {
      studentId: b.student_id, personId: b.person_id, parentPersonId: b.parent_id, register: b.register, semester: b.semester,
      section: s?.section ?? "Section A", realAttendance: s?.att != null ? Number(s.att) : null,
      mentorId: b.mentor_id, excluded: opts.excludeStudentIds.includes(b.student_id), keepMentor: b.keep_mentor, keepFees: b.keep_fees,
      lastActivityAgeDays: b.last_activity ? Math.max(0, Math.floor((asOfMs - b.last_activity.getTime()) / DAY)) : 60,
      baseMarkId, resultId, submissionId, invoiceId: b.invoice_id, internship: pick("internship"), placement: pick("placement"),
    };
  });
  return {
    seed: opts.seed, label: opts.label, asOf: opts.asOf, students, termId: term.id, generation: gen, operatorId: operator.id, hodId: hod.id,
    mentors: mentors.map((m) => m.id),
    courses: courses.map((x) => ({ offeringId: x.offering_id, code: x.code, facultyId: x.faculty_id, baseAssessmentId: x.assessment_id, assignmentId: x.assignment_id, lessonId: x.lesson_id, assignmentDueAt: x.due_at.toISOString() })),
  };
}

// ---------------------------------------------------------------------------
// Bulk helpers. Every column travels as text and is cast in SQL.

export type Col = [name: string, type: string];
export async function bulkInsert(c: PoolClient, table: string, cols: Col[], rows: Array<Array<string | number | null>>, tail = "") {
  for (let start = 0; start < rows.length; start += 1500) {
    const chunk = rows.slice(start, start + 1500);
    const arrays = cols.map((_, i) => chunk.map((r) => (r[i] === null || r[i] === undefined ? null : String(r[i]))));
    await c.query(
      `INSERT INTO ${table}(${cols.map(([n]) => n).join(",")}) SELECT ${cols.map(([, t], i) => `x.c${i}::${t}`).join(",")} FROM unnest(${cols.map((_, i) => `$${i + 1}::text[]`).join(",")}) AS x(${cols.map((_, i) => `c${i}`).join(",")}) ${tail}`,
      arrays,
    );
  }
}
/** Updates `set` columns of rows matched by id, after saving each previous row image. */
export async function revise(
  c: PoolClient,
  ctx: { generation: string; actor: string; reason: string },
  table: string,
  resource: string,
  set: Col[],
  rows: Array<{ id: string; values: Array<string | number | null> }>,
  extra = "revision=t.revision+1",
) {
  for (let start = 0; start < rows.length; start += 1000) {
    const chunk = rows.slice(start, start + 1000);
    const ids = chunk.map((r) => r.id);
    const arrays = set.map((_, i) => chunk.map((r) => (r.values[i] === null ? null : String(r.values[i]))));
    const updatedJson = chunk.map((r) => JSON.stringify(Object.fromEntries(set.map(([n], i) => [n, r.values[i]]))));
    await c.query(
      `INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated)
       SELECT gen_random_uuid(),t.generation_id,$1,$2,t.id,$3,to_jsonb(t),v.u::jsonb FROM ${table} t JOIN unnest($4::text[],$5::text[]) AS v(id,u) ON t.id=v.id::uuid`,
      [ctx.actor, resource, ctx.reason, ids, updatedJson],
    );
    const res = await c.query(
      `UPDATE ${table} t SET ${set.map(([n, ty], i) => `${n}=v.c${i}::${ty}`).join(",")}${extra ? "," + extra : ""}
       FROM unnest($1::text[],${set.map((_, i) => `$${i + 2}::text[]`).join(",")}) AS v(id,${set.map((_, i) => `c${i}`).join(",")})
       WHERE t.id=v.id::uuid`,
      [ids, ...arrays],
    );
    if (res.rowCount !== chunk.length) throw new Error(`${table}: expected ${chunk.length} updates, got ${res.rowCount}`);
  }
}

export type ApplyResult = { label: string; counts: Record<string, number>; summary: Record<string, unknown>; checksum: string };

export async function applyRefresh(c: PoolClient, input: Awaited<ReturnType<typeof loadRefreshInput>>, plan: Plan): Promise<ApplyResult> {
  const { generation, operatorId, hodId } = input;
  const label = plan.label;
  const existing = await c.query("SELECT 1 FROM data_generations WHERE generation_id=$1 AND label=$2", [generation, label]);
  if (existing.rowCount) throw new Error(`Data generation ${label} is already applied`);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`data-refresh:${generation}`]);
  const ctx = { generation, actor: operatorId, reason: `Data refresh ${label}: generated records replaced by a realistic generation; previous image kept` };
  const counts: Record<string, number> = {};
  const note = (k: string, n: number) => { counts[k] = n; };

  // Assessments
  await bulkInsert(c, "assessments", [["id", "uuid"], ["generation_id", "uuid"], ["course_offering_id", "uuid"], ["title", "text"], ["category", "text"], ["maximum_score", "numeric"], ["weight_percent", "numeric"], ["published", "boolean"]],
    plan.assessments.map((a) => [a.id, generation, a.offeringId, a.title, "CIE", a.max, a.weight, "true"]));
  note("assessmentsAdded", plan.assessments.length);
  await revise(c, ctx, "assessments", "assessment", [["weight_percent", "numeric"]], plan.reweigh.map((r) => ({ id: r.id, values: [r.weight] })));
  note("assessmentsReweighted", plan.reweigh.length);

  // Marks and results
  await revise(c, ctx, "marks", "mark", [["score", "numeric"], ["feedback", "text"], ["recorded_at", "timestamptz"], ["recorded_by_person_id", "uuid"]],
    plan.markUpdates.map((m) => ({ id: m.id, values: [m.score, m.feedback, m.recordedAt, m.recordedBy] })));
  note("marksRevised", plan.markUpdates.length);
  await bulkInsert(c, "marks", [["id", "uuid"], ["generation_id", "uuid"], ["assessment_id", "uuid"], ["student_id", "uuid"], ["score", "numeric"], ["feedback", "text"], ["recorded_by_person_id", "uuid"], ["recorded_at", "timestamptz"]],
    plan.markInserts.map((m) => [m.id, generation, m.assessmentId, m.studentId, m.score, m.feedback, m.recordedBy, m.recordedAt]));
  note("marksAdded", plan.markInserts.length);
  await revise(c, ctx, "course_results", "course_result", [["percentage", "numeric"], ["grade_point", "numeric"], ["letter", "text"], ["recorded_at", "timestamptz"]],
    plan.resultUpdates.map((r) => ({ id: r.id, values: [r.percentage, r.gradePoint, r.letter, plan.asOf] })));
  note("resultsRevised", plan.resultUpdates.length);

  // LMS
  await revise(c, ctx, "lms_submissions", "lms_submission", [["submitted_at", "timestamptz"], ["score", "numeric"], ["feedback", "text"], ["graded_by", "uuid"], ["graded_at", "timestamptz"]],
    plan.submissionUpdates.map((s) => ({ id: s.id, values: [s.submittedAt, s.score, s.feedback, s.gradedBy, s.gradedAt] })));
  note("submissionsRevised", plan.submissionUpdates.length);
  await bulkInsert(c, "lms_submissions", [["id", "uuid"], ["generation_id", "uuid"], ["assignment_id", "uuid"], ["student_id", "uuid"], ["answer", "text"], ["submitted_at", "timestamptz"], ["score", "numeric"], ["feedback", "text"], ["graded_by", "uuid"], ["graded_at", "timestamptz"]],
    plan.submissionInserts.map((s) => [s.id, generation, s.assignmentId, s.studentId, s.answer, s.submittedAt, s.score, s.feedback, s.gradedBy, s.gradedAt]));
  note("submissionsAdded", plan.submissionInserts.length);
  await bulkInsert(c, "lms_activity", [["id", "uuid"], ["generation_id", "uuid"], ["student_id", "uuid"], ["course_offering_id", "uuid"], ["resource_id", "uuid"], ["kind", "text"], ["occurred_at", "timestamptz"]],
    plan.activity.map((a) => [a.id, generation, a.studentId, a.offeringId, a.resourceId, a.kind, a.occurredAt]));
  note("activityAdded", plan.activity.length);

  // Internships and placements
  await revise(c, ctx, "ch11_sources", "career_record", [["record", "jsonb"]], plan.sourceUpdates.map((u) => ({ id: u.id, values: [JSON.stringify(u.record)] })), "");
  note("careerRecordsRevised", plan.sourceUpdates.length);

  // Fees: the old unpaid invoice is voided (kept), new invoices and receipts are added.
  await revise(c, ctx, "fee_invoices", "fee_invoice", [["status", "text"], ["description", "text"]],
    plan.invoiceVoids.map((v) => ({ id: v.id, values: ["void", "Semester tuition and laboratory fee (replaced by the 2026 odd-semester fee schedule)"] })));
  note("invoicesVoided", plan.invoiceVoids.length);
  await bulkInsert(c, "fee_invoices", [["id", "uuid"], ["generation_id", "uuid"], ["student_id", "uuid"], ["term_id", "uuid"], ["invoice_number", "text"], ["description", "text"], ["record_origin", "text"], ["amount_paise", "bigint"], ["paid_paise", "bigint"], ["due_on", "date"], ["status", "text"]],
    plan.invoiceInserts.map((i) => [i.id, generation, i.studentId, input.termId, i.number, i.description, "generated_project_operations", i.amount, i.paid, i.dueOn, i.status]));
  note("invoicesAdded", plan.invoiceInserts.length);
  await bulkInsert(c, "payment_transactions", [["id", "uuid"], ["generation_id", "uuid"], ["invoice_id", "uuid"], ["amount_paise", "bigint"], ["provider", "text"], ["provider_reference", "text"], ["status", "text"], ["paid_by_person_id", "uuid"], ["created_at", "timestamptz"]],
    plan.payments.map((p) => [p.id, generation, p.invoiceId, p.amount, p.provider, p.reference, "captured", p.paidBy, p.createdAt]));
  note("receiptsAdded", plan.payments.length);

  // Mentor split
  const moves = plan.mentorMoves;
  if (moves.length) {
    const ids = (await c.query<{ id: string; student_id: string }>("SELECT id,student_id FROM mentor_assignments WHERE generation_id=$1 AND student_id=ANY($2::uuid[])", [generation, moves.map((m) => m.studentId)])).rows;
    const rowOf = new Map(ids.map((r) => [r.student_id, r.id]));
    await revise(c, ctx, "mentor_assignments", "mentor_assignment", [["faculty_person_id", "uuid"], ["assigned_by", "uuid"], ["updated_at", "timestamptz"]],
      moves.map((m) => ({ id: rowOf.get(m.studentId)!, values: [m.to, hodId, plan.asOf] })));
  }
  note("mentorAssignmentsMoved", moves.length);

  const checksum = digest({ marks: plan.markUpdates.length + plan.markInserts.length, plan: { label, seed: plan.seed, asOf: plan.asOf, counts } });
  const summary = { ...plan.summary, counts, asOf: plan.asOf, seed: plan.seed, excludedStudents: input.students.filter((s) => s.excluded).length };
  const id = projectId(plan.seed, `${label}:data-generation`);
  await c.query(
    "INSERT INTO data_generations(id,generation_id,label,seed,as_of,supersedes_label,summary,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
    [id, generation, label, plan.seed, plan.asOf, "seed-v1", JSON.stringify(summary), operatorId],
  );
  await writeCommandLedger(c, {
    generationId: generation, commandId: projectId(plan.seed, `${label}:ledger:apply`), actorPersonId: operatorId,
    aggregateType: "data_generation", aggregateId: id, eventType: "data.generation.activated", action: "data.generation.activate", topic: "data.generation",
    payload: { label, counts, asOf: plan.asOf, checksum }, metadata: { performedBy: "Claude, authorised by the project owner", additiveOnly: true },
  });
  return { label, counts, summary, checksum };
}

/** Marks open drafts computed on the previous data as superseded. No row is deleted;
 * each case keeps its evidence, runs, artifacts and history. */
export async function supersedeStaleDrafts(
  c: PoolClient,
  opts: { label: string; operatorId: string; excludeStudentIds: string[]; reason?: string; seed?: string },
): Promise<{ superseded: number; keptPending: number }> {
  const gen = await getCurrentGeneration(c);
  const reason = opts.reason ?? "superseded by data refresh";
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`data-refresh-supersede:${gen}`]);
  const open = (await c.query<{ id: string; student_id: string; revision: number }>(
    "SELECT id,student_id,revision FROM support_cases WHERE generation_id=$1 AND status='awaiting_faculty' ORDER BY opened_at",
    [gen],
  )).rows;
  const target = open.filter((x) => !opts.excludeStudentIds.includes(x.student_id));
  if (target.length) {
    const ids = target.map((x) => x.id);
    await c.query(
      `INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated)
       SELECT gen_random_uuid(),t.generation_id,$1,'support_case',t.id,$2,to_jsonb(t),jsonb_build_object('status','superseded','reason',$2::text) FROM support_cases t WHERE t.id=ANY($3::uuid[])`,
      [opts.operatorId, `${reason} (${opts.label})`, ids],
    );
    await c.query(
      `INSERT INTO ch11_events(id,generation_id,subject_id,actor_person_id,event_type,input_hash,output_hash,detail)
       SELECT gen_random_uuid(),t.generation_id,t.id,$1,'case.superseded',$4,$5,jsonb_build_object('reason',$2::text,'dataGeneration',$3::text,'previousStatus','awaiting_faculty') FROM support_cases t WHERE t.id=ANY($6::uuid[])`,
      [opts.operatorId, reason, opts.label, digest({ status: "awaiting_faculty" }), digest({ status: "superseded", reason }), ids],
    );
    const res = await c.query("UPDATE support_cases SET status='superseded',revision=revision+1 WHERE id=ANY($1::uuid[]) AND status='awaiting_faculty'", [ids]);
    if (res.rowCount !== ids.length) throw new Error("Unexpected number of superseded cases");
    await writeCommandLedger(c, {
      generationId: gen, commandId: randomUUID(), actorPersonId: opts.operatorId, aggregateType: "data_generation", aggregateId: projectId(opts.seed ?? "aura-realistic-data-v2", `${opts.label}:data-generation`),
      eventType: "data.drafts.superseded", action: "data.drafts.supersede", topic: "data.generation", payload: { label: opts.label, superseded: ids.length, reason },
      metadata: { performedBy: "Claude, authorised by the project owner", keptPending: open.length - ids.length },
    });
  }
  return { superseded: target.length, keptPending: open.length - target.length };
}
