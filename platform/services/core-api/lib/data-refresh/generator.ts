/**
 * Realistic generated records for the college project (data refresh "realistic-v2").
 *
 * Pure and deterministic: the same seed, label, as-of time and inputs always give the
 * same plan, and each student's draws depend only on that student's key (never on
 * the order of the list), so adding or excluding a student never shifts anyone else.
 *
 * Only generated operations are planned here: marks, course results, LMS submissions
 * and activity, internship and placement records, fee invoices and receipts, and the
 * mentor split. The supplied college attendance (`project_dataset`) and the generated
 * attendance sessions and records are never inputs to a write. The students' real
 * attendance is an input only as a weak covariate for marks and engagement.
 */
import { createHash } from "node:crypto";
import { demoBands } from "../experience-seed";

export const REFRESH_LABEL = "realistic-v2";
export const REFRESH_SEED = "aura-realistic-data-v2";
const DAY = 86400000;

// ---------------------------------------------------------------------------
// Seeded randomness

export type Rng = () => number;
/** A fresh stream per (seed, parts). SHA-256 -> mulberry32. */
export function stream(seed: string, ...parts: Array<string | number>): Rng {
  const h = createHash("sha256").update([seed, ...parts].join("\u0000")).digest();
  let a = h.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
/** Standard normal CDF (Abramowitz and Stegun 7.1.26). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp((-x * x) / 2);
  return 0.5 * (1 + (x >= 0 ? y : -y));
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const roundHalf = (x: number) => Math.round(x * 2) / 2;
export function projectId(seed: string, label: string): string {
  const h = createHash("sha256").update(`aura.project-cohort.v1:${seed}:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const pick = <T>(rng: Rng, items: Array<[T, number]>): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [item, w] of items) {
    x -= w;
    if (x <= 0) return item;
  }
  return items[items.length - 1]![0];
};

// ---------------------------------------------------------------------------
// Inputs and outputs

export type SourceRow = { id: string; record: Record<string, unknown> };
export type RefreshStudent = {
  studentId: string;
  personId: string;
  parentPersonId: string | null;
  register: string;
  semester: number;
  /** Section of the latest supplied report, for example "Section A". */
  section: string;
  /** Mean of the student's numeric supplied attendance cells, 0 to 100, or null. */
  realAttendance: number | null;
  mentorId: string;
  /** Excluded from every write (student 021). */
  excluded: boolean;
  /** Keeps the current mentor (approved or published support exists). */
  keepMentor: boolean;
  /** Has payment history: the existing invoice stays as recorded. */
  keepFees: boolean;
  /** Whole days from the latest existing LMS activity to the as-of time. */
  lastActivityAgeDays: number;
  baseMarkId: Record<string, string | undefined>;
  resultId: Record<string, string | undefined>;
  submissionId: Record<string, string | undefined>;
  invoiceId: string | null;
  internship: SourceRow | null;
  placement: SourceRow | null;
};
export type RefreshCourse = {
  offeringId: string;
  code: string;
  facultyId: string;
  baseAssessmentId: string;
  assignmentId: string;
  lessonId: string;
  assignmentDueAt: string;
};
export type RefreshInput = {
  seed: string;
  label: string;
  asOf: string;
  students: RefreshStudent[];
  courses: RefreshCourse[];
  /** Mentor person ids in a stable order. */
  mentors: string[];
  termId: string;
};

export type MarkWrite = { id: string; assessmentId: string; studentId: string; score: number; feedback: string; recordedAt: string; recordedBy: string };
export type Plan = {
  label: string;
  seed: string;
  asOf: string;
  assessments: Array<{ id: string; offeringId: string; title: string; max: number; weight: number }>;
  reweigh: Array<{ id: string; weight: number }>;
  markUpdates: MarkWrite[];
  markInserts: MarkWrite[];
  resultUpdates: Array<{ id: string; percentage: number; gradePoint: number; letter: string }>;
  submissionUpdates: Array<{ id: string; submittedAt: string; score: number | null; feedback: string; gradedBy: string | null; gradedAt: string | null }>;
  submissionInserts: Array<{ id: string; assignmentId: string; studentId: string; answer: string; submittedAt: string; score: number | null; feedback: string; gradedBy: string | null; gradedAt: string | null }>;
  activity: Array<{ id: string; studentId: string; offeringId: string; resourceId: string; kind: "lesson_opened" | "assignment_submitted"; occurredAt: string }>;
  sourceUpdates: Array<{ id: string; studentId: string; source: "internship" | "placement"; record: Record<string, unknown> }>;
  invoiceVoids: Array<{ id: string; studentId: string }>;
  invoiceInserts: Array<{ id: string; studentId: string; number: string; description: string; amount: number; paid: number; dueOn: string; status: "due" | "partial" | "paid" }>;
  payments: Array<{ id: string; invoiceId: string; amount: number; provider: string; reference: string; paidBy: string; createdAt: string }>;
  mentorMoves: Array<{ studentId: string; from: string; to: string }>;
  summary: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Course character. Courses differ in difficulty, spread and in how much they
// reward attendance and steady work.

const COURSE_CHARACTER: Record<string, { shift: number; spread: number }> = {
  CS401: { shift: -5, spread: 1.15 },
  CS402: { shift: 1.5, spread: 0.95 },
  CS403: { shift: 4, spread: 0.85 },
};
const COMPONENTS = [
  { key: "base", title: "Course assessment", max: 100, weight: 40 },
  { key: "t2", title: "Internal test 2", max: 50, weight: 35 },
  { key: "asg", title: "Assignment and lab record", max: 20, weight: 25 },
] as const;
const FEEDBACK = {
  strong: ["Strong, well-organised answers. Push on the harder problems next.", "Excellent grasp of the core ideas; keep the working visible.", "Very good. Check units and edge cases to stay at this level."],
  steady: ["Solid work. Revisit the questions where marks were lost on method.", "Good understanding overall; practise the longer problems.", "Reasonable result. Tighten the explanation of your steps."],
  weak: ["Basics need revision before the next test; see me in office hours.", "Several concepts are unclear. Work the practice set and resubmit the corrections.", "Below the expected level. Attend the revision session and bring your doubts."],
};
const fbFor = (pct: number, rng: Rng) => {
  const list = pct >= 75 ? FEEDBACK.strong : pct >= 55 ? FEEDBACK.steady : FEEDBACK.weak;
  return list[Math.floor(rng() * list.length)]!;
};

// ---------------------------------------------------------------------------
// Right-skewed inactivity targets: most 0 to 3 days, a long tail.

const INACTIVITY_QUANTILES: Array<[number, number]> = [
  [0.0, 0], [0.3, 0], [0.5, 1], [0.63, 2], [0.72, 3], [0.79, 4], [0.84, 5],
  [0.88, 7], [0.92, 10], [0.955, 14], [0.98, 18], [1.0, 26],
];
export function inactivityAt(p: number): number {
  for (let i = 1; i < INACTIVITY_QUANTILES.length; i++) {
    const [p1, d1] = INACTIVITY_QUANTILES[i]!;
    const [p0, d0] = INACTIVITY_QUANTILES[i - 1]!;
    if (p <= p1) return Math.round(d0 + ((d1 - d0) * (p - p0)) / Math.max(p1 - p0, 1e-9));
  }
  return 26;
}

// ---------------------------------------------------------------------------

type Latent = { ability: number; attendanceZ: number; theta: number; engagement: number; struggling: boolean };

export function planRefresh(input: RefreshInput): Plan {
  const { seed, label } = input;
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error("A valid as-of time is required");
  const at = (offsetDays: number) => new Date(asOf + offsetDays * DAY).toISOString();
  const key = (...parts: Array<string | number>) => projectId(seed, `${label}:${parts.join(":")}`);
  const active = input.students.filter((s) => !s.excluded);

  // Standardise the supplied attendance across the cohort (weak covariate only).
  const att = active.map((s) => s.realAttendance).filter((x): x is number => x !== null);
  const attMean = att.reduce((a, b) => a + b, 0) / Math.max(att.length, 1);
  const attSd = Math.sqrt(att.reduce((a, b) => a + (b - attMean) ** 2, 0) / Math.max(att.length, 1)) || 1;

  const latent = new Map<string, Latent>();
  for (const s of active) {
    const r = stream(seed, label, "latent", s.studentId);
    const ability = normal(r);
    const attendanceZ = s.realAttendance === null ? 0 : clamp((s.realAttendance - attMean) / attSd, -2.5, 2.5);
    const struggling = r() < 0.09;
    const strong = r() < 0.05;
    let theta = 0.86 * ability + 0.32 * attendanceZ;
    if (struggling) theta -= 1.0 + 0.5 * Math.abs(normal(r));
    if (strong) theta += 0.7;
    latent.set(s.studentId, { ability, attendanceZ, theta, engagement: normal(r), struggling });
  }

  const plan: Plan = {
    label, seed, asOf: input.asOf,
    assessments: [], reweigh: [], markUpdates: [], markInserts: [], resultUpdates: [],
    submissionUpdates: [], submissionInserts: [], activity: [], sourceUpdates: [],
    invoiceVoids: [], invoiceInserts: [], payments: [], mentorMoves: [], summary: {},
  };

  // ---- Assessments -------------------------------------------------------
  const assessmentId = new Map<string, string>(); // `${offering}:${key}` -> id
  for (const c of input.courses) {
    assessmentId.set(`${c.offeringId}:base`, c.baseAssessmentId);
    plan.reweigh.push({ id: c.baseAssessmentId, weight: COMPONENTS[0].weight });
    for (const comp of COMPONENTS.slice(1)) {
      const id = key("assessment", c.offeringId, comp.key);
      assessmentId.set(`${c.offeringId}:${comp.key}`, id);
      plan.assessments.push({ id, offeringId: c.offeringId, title: comp.title, max: comp.max, weight: comp.weight });
    }
  }

  // ---- Marks and results -------------------------------------------------
  const coursePct = new Map<string, number>(); // `${student}:${offering}` -> weighted %
  for (const s of active) {
    const L = latent.get(s.studentId)!;
    const trend = normal(stream(seed, label, "trend", s.studentId)) * 3;
    for (const c of input.courses) {
      const r = stream(seed, label, "marks", s.studentId, c.offeringId);
      const ch = COURSE_CHARACTER[c.code] ?? { shift: 0, spread: 1 };
      const affinity = normal(r) * 4.5;
      const level = 65 + ch.shift + 10.5 * L.theta * ch.spread + affinity;
      const pct: Record<string, number | null> = {
        base: clamp(level + normal(r) * 6.5, 0, 100),
        t2: r() < 0.035 + 0.03 * Math.max(0, -L.theta) ? null : clamp(level + trend + normal(r) * 6.5, 0, 100),
        asg: r() < 0.05 + 0.04 * Math.max(0, -L.theta) ? null : clamp(level + 6 + normal(r) * 8, 0, 100),
      };
      const dates: Record<string, string> = {
        base: at(-34 + (r() - 0.5) * 4), t2: at(-13 + (r() - 0.5) * 4), asg: at(-5 - r() * 4),
      };
      let weighted = 0, weightSum = 0;
      for (const comp of COMPONENTS) {
        const p = pct[comp.key];
        if (p === null || p === undefined) continue;
        const write: MarkWrite = {
          id: comp.key === "base" ? (s.baseMarkId[c.offeringId] ?? key("mark", s.studentId, c.offeringId, "base")) : key("mark", s.studentId, c.offeringId, comp.key),
          assessmentId: assessmentId.get(`${c.offeringId}:${comp.key}`)!,
          studentId: s.studentId,
          score: clamp(roundHalf((p / 100) * comp.max), 0, comp.max),
          feedback: fbFor(p, r),
          recordedAt: dates[comp.key]!,
          recordedBy: c.facultyId,
        };
        if (comp.key === "base" && s.baseMarkId[c.offeringId]) plan.markUpdates.push(write);
        else plan.markInserts.push(write);
        weighted += (write.score / comp.max) * 100 * comp.weight;
        weightSum += comp.weight;
      }
      const overall = weightSum ? round1(weighted / weightSum) : 0;
      coursePct.set(`${s.studentId}:${c.offeringId}`, overall);
      const resId = s.resultId[c.offeringId];
      if (resId) {
        const band = demoBands.find((b) => overall >= b.minimum)!;
        plan.resultUpdates.push({ id: resId, percentage: overall, gradePoint: band.points, letter: band.letter });
      }
    }
  }

  // ---- LMS: inactivity targets, submissions, activity ---------------------
  // Existing activity cannot be removed, so no student can be made more recent than
  // never and no student less active than the existing latest activity allows.
  const propensity = new Map<string, number>();
  for (const s of active) {
    const L = latent.get(s.studentId)!;
    const e = normal(stream(seed, label, "inactive", s.studentId));
    propensity.set(s.studentId, -0.55 * (0.55 * L.ability + 0.3 * L.attendanceZ + 0.78 * L.engagement) + 0.8 * e);
  }
  const order = [...active].sort((a, b) => propensity.get(b.studentId)! - propensity.get(a.studentId)! || a.register.localeCompare(b.register));
  const n = order.length;
  const targets = Array.from({ length: n }, (_, i) => inactivityAt(1 - (i + 0.5) / n)).sort((a, b) => b - a);
  const inactivity = new Map<string, number>();
  const free = new Set(order.map((s) => s.studentId));
  // Most inactive targets first, to the most inactive-prone student whose existing
  // activity is old enough to allow it.
  for (const target of targets) {
    let chosen: RefreshStudent | undefined;
    for (const s of order) {
      if (free.has(s.studentId) && s.lastActivityAgeDays >= target) { chosen = s; break; }
    }
    chosen ??= order.filter((s) => free.has(s.studentId)).sort((a, b) => b.lastActivityAgeDays - a.lastActivityAgeDays)[0]!;
    free.delete(chosen.studentId);
    inactivity.set(chosen.studentId, Math.min(target, chosen.lastActivityAgeDays));
  }

  for (const s of active) {
    const L = latent.get(s.studentId)!;
    const days = inactivity.get(s.studentId)!;
    const r = stream(seed, label, "lms", s.studentId);
    const lastAllowed = asOf - days * DAY - r() * 0.85 * DAY; // the latest new activity
    const hour = () => (4 + Math.floor(r() * 15)) * 3600000; // 09:30 to 24:30 IST in UTC ms
    const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;
    const stamp = (ms: number) => new Date(clamp(dayStart(ms) + hour(), asOf - 38 * DAY, lastAllowed)).toISOString();
    // A designated last activity, only when it can be more recent than the existing one.
    if (days < s.lastActivityAgeDays) {
      const c = input.courses[Math.floor(r() * input.courses.length)]!;
      plan.activity.push({ id: key("activity", s.studentId, "last"), studentId: s.studentId, offeringId: c.offeringId, resourceId: c.lessonId, kind: "lesson_opened", occurredAt: new Date(lastAllowed).toISOString() });
    }
    // Earlier history, denser for engaged students.
    const history = 2 + Math.round(6 * phi(L.engagement * 0.8 + L.ability * 0.3));
    for (let k = 0; k < history; k++) {
      const c = input.courses[Math.floor(r() * input.courses.length)]!;
      const when = lastAllowed - (0.4 + r() * 28) * DAY;
      plan.activity.push({ id: key("activity", s.studentId, "h", k), studentId: s.studentId, offeringId: c.offeringId, resourceId: c.lessonId, kind: "lesson_opened", occurredAt: stamp(when) });
    }
    // Submissions.
    for (const c of input.courses) {
      const rs = stream(seed, label, "submission", s.studentId, c.offeringId);
      const existing = s.submissionId[c.offeringId];
      const due = Date.parse(c.assignmentDueAt);
      const pMiss = clamp(0.30 - 0.12 * L.engagement - 0.05 * L.theta, 0.04, 0.8);
      if (!existing && rs() < pMiss) continue; // genuinely not submitted: overdue
      let when: number;
      const roll = rs();
      if (roll < 0.14 + 0.06 * Math.max(0, -L.engagement)) when = due + (0.15 + rs() * 5.5) * DAY; // late
      else if (roll < 0.32) when = due - (0.02 + rs() * 0.6) * DAY; // last-minute
      else when = due - (0.7 + rs() * 6) * DAY; // comfortably early
      when = Math.min(when, lastAllowed);
      const submittedAt = new Date(clamp(dayStart(when) + hour(), asOf - 30 * DAY, lastAllowed)).toISOString();
      const lateBy = Date.parse(submittedAt) - due;
      const graded = rs() < 0.84 && Date.parse(submittedAt) < asOf - 1.2 * DAY;
      const pct = coursePct.get(`${s.studentId}:${c.offeringId}`) ?? 60;
      const score = graded ? clamp(roundHalf(20 * (pct / 100 + normal(rs) * 0.07 - (lateBy > 0 ? 0.06 : 0))), 0, 20) : null;
      const gradedAt = graded ? new Date(Math.min(asOf - 0.1 * DAY, Date.parse(submittedAt) + (0.6 + rs() * 4) * DAY)).toISOString() : null;
      const feedback = graded ? (score! >= 15 ? "Clear reasoning. Add a counterexample to strengthen the answer." : score! >= 10 ? "Right idea, but the failure case is thin. Test one more boundary." : "The worked example does not yet support the claim; revisit the assumptions.") : "";
      if (existing) plan.submissionUpdates.push({ id: existing, submittedAt, score, feedback, gradedBy: graded ? c.facultyId : null, gradedAt });
      else plan.submissionInserts.push({ id: key("submission", s.studentId, c.offeringId), assignmentId: c.assignmentId, studentId: s.studentId, answer: "A clear objective, a worked example and a boundary check make the result easier to assess.", submittedAt, score, feedback, gradedBy: graded ? c.facultyId : null, gradedAt });
      plan.activity.push({ id: key("activity", s.studentId, c.offeringId, "submitted"), studentId: s.studentId, offeringId: c.offeringId, resourceId: c.assignmentId, kind: "assignment_submitted", occurredAt: submittedAt });
    }
  }

  // ---- Internships and placements ----------------------------------------
  const SOURCE_MIX: Record<"internship" | "placement", Record<number, [number, number, number, number]>> = {
    // [not applicable, on track, one missed, several missed]
    internship: { 4: [0.72, 0.20, 0.06, 0.02], 6: [0.15, 0.45, 0.27, 0.13], 8: [0.06, 0.50, 0.24, 0.20] },
    placement: { 4: [0.86, 0.10, 0.03, 0.01], 6: [0.45, 0.33, 0.17, 0.05], 8: [0.08, 0.30, 0.32, 0.30] },
  };
  for (const s of active) {
    const L = latent.get(s.studentId)!;
    for (const source of ["internship", "placement"] as const) {
      const row = s[source];
      if (!row) continue;
      const r = stream(seed, label, source, s.studentId);
      const mix = SOURCE_MIX[source][s.semester] ?? SOURCE_MIX[source][6]!;
      const notApplicable = r() < mix[0];
      const rest = mix[1] + mix[2] + mix[3];
      // Better-placed students (ability, engagement) drift towards "on track".
      const u = phi(-0.4 * (0.6 * L.theta + 0.6 * L.engagement) + 0.92 * normal(r));
      const pOk = mix[1] / rest, pOne = mix[2] / rest;
      const missed = notApplicable ? 0 : u < pOk ? 0 : u < pOk + pOne ? 1 : pick(r, [[2, 0.6], [3, 0.27], [4, 0.13]]);
      const stage = notApplicable ? "not_applicable" : missed === 0 ? "on_track" : missed === 1 ? "one_missed" : "several_missed";
      const base = row.record as { recordId?: string; semester?: string };
      plan.sourceUpdates.push({
        id: row.id, studentId: s.studentId, source,
        record: {
          source, studentId: s.studentId, recordId: base.recordId ?? row.id,
          observedAt: at(-(0.4 + r() * 12)), semester: base.semester ?? "2026-ODD",
          state: notApplicable ? "not_applicable" : "present", synthetic: true,
          values: { [source === "internship" ? "missedMilestones" : "missedActivities"]: missed, status: stage, origin: "generated_project_operations", dataGeneration: label },
        },
      });
    }
  }

  // ---- Fees ---------------------------------------------------------------
  const CATEGORIES: Array<[{ name: string; tuition: number }, number]> = [
    [{ name: "Government quota", tuition: 34000 }, 0.42],
    [{ name: "COMEDK quota", tuition: 62000 }, 0.25],
    [{ name: "Management quota", tuition: 98000 }, 0.2],
    [{ name: "Diploma lateral entry", tuition: 30000 }, 0.1],
    [{ name: "NRI quota", tuition: 145000 }, 0.03],
  ];
  const EXAM_FEE: Record<number, number> = { 4: 4800, 6: 5200, 8: 6000 };
  for (const s of active) {
    if (s.keepFees) continue;
    const L = latent.get(s.studentId)!;
    const r = stream(seed, label, "fees", s.studentId);
    const category = pick(r, CATEGORIES);
    // Scholarships: merit for strong students, need-based for some others.
    const merit = L.theta > 1.05 && r() < 0.55;
    const need = !merit && r() < 0.09;
    const waiver = merit ? pick(r, [[25, 0.45], [50, 0.4], [75, 0.15]]) : need ? pick(r, [[25, 0.3], [50, 0.5], [75, 0.2]]) : 0;
    const tuition = Math.round((category.tuition * (100 - waiver)) / 100);
    const issued = asOf - (46 + Math.floor(r() * 8)) * DAY;
    const u = phi(0.35 * (-L.engagement - 0.5 * L.theta) + 0.94 * normal(r));
    const state: "paid" | "partial" | "overdue" = u < 0.80 ? "paid" : u < 0.95 ? "partial" : "overdue";
    const parent = s.parentPersonId ?? s.personId;
    const tag = s.register.replace(/[^A-Za-z0-9]/g, "");
    const lines: Array<{ code: string; description: string; amount: number; own?: boolean }> = [
      { code: "T", description: `Semester tuition: ${category.name}${waiver ? `, ${merit ? "merit" : "need-based"} scholarship ${waiver}% applied` : ""}`, amount: tuition },
      { code: "X", description: "Examination and laboratory fee", amount: EXAM_FEE[s.semester] ?? 5200 },
    ];
    if (r() < 0.31) lines.push({ code: "H", description: "Hostel and mess fee", amount: 41000 });
    else if (r() < 0.14) lines.push({ code: "B", description: "Bus transport fee", amount: 9500 });
    plan.invoiceVoids.push({ id: s.invoiceId ?? "", studentId: s.studentId });
    lines.forEach((line, index) => {
      const id = key("invoice", s.studentId, line.code);
      const isTuition = index === 0;
      let dueDate: number;
      if (state === "overdue") dueDate = asOf - (6 + r() * 33) * DAY;
      else if (state === "partial") dueDate = r() < 0.5 ? asOf - (3 + r() * 20) * DAY : asOf + (5 + r() * 25) * DAY;
      else dueDate = r() < 0.12 ? asOf + (2 + r() * 20) * DAY : asOf - (3 + r() * 30) * DAY;
      if (!isTuition) dueDate += (r() < 0.5 ? 1 : 0) * 7 * DAY;
      const dueOn = new Date(dueDate).toISOString().slice(0, 10);
      const amount = line.amount * 100;
      let paid = 0;
      if (state === "paid") paid = r() < 0.04 && !isTuition ? 0 : amount;
      else if (state === "partial") paid = isTuition ? Math.round((amount * (0.35 + r() * 0.5)) / 10000) * 10000 : r() < 0.6 ? amount : 0;
      else paid = !isTuition && r() < 0.15 ? amount : 0;
      paid = clamp(paid, 0, amount);
      const status: "due" | "partial" | "paid" = paid === 0 ? "due" : paid >= amount ? "paid" : "partial";
      plan.invoiceInserts.push({ id, studentId: s.studentId, number: `FEE-26ODD-${tag}-${line.code}`, description: line.description, amount, paid, dueOn, status });
      if (paid > 0) {
        const parts = status === "paid" && r() < 0.28 ? 2 : 1;
        let left = paid;
        for (let k = 0; k < parts; k++) {
          const part = k === parts - 1 ? left : Math.round((paid * (0.5 + r() * 0.2)) / 100) * 100;
          left -= part;
          const latest = Math.min(dueDate, asOf - 0.2 * DAY);
          const earliest = issued + 1 * DAY;
          const rush = r() < 0.45 ? latest - r() * 5 * DAY : earliest + r() * Math.max(latest - earliest, 0.5 * DAY);
          const when = clamp(rush, earliest, Math.max(latest, earliest + 0.5 * DAY));
          const receipt = new Date(Math.min(when, asOf - 0.1 * DAY));
          receipt.setUTCHours(4 + Math.floor(r() * 12), Math.floor(r() * 60), 0, 0);
          if (receipt.getTime() > asOf - 3600000) receipt.setTime(receipt.getTime() - DAY);
          plan.payments.push({
            id: key("payment", s.studentId, line.code, k), invoiceId: id, amount: part,
            provider: pick(r, [["UPI", 0.5], ["Net banking", 0.22], ["Card", 0.14], ["Bank challan", 0.14]]),
            reference: `RCPT-26ODD-${tag}-${line.code}${k + 1}`, paidBy: parent, createdAt: receipt.toISOString(),
          });
        }
      }
    });
  }
  plan.invoiceVoids = plan.invoiceVoids.filter((v) => v.id);

  // ---- Mentor split -------------------------------------------------------
  // Whole sections go together; loads are uneven but plausible. Students whose
  // support already exists keep their mentor.
  const mentors = input.mentors;
  const total = input.students.filter((s) => !s.excluded || s.mentorId).length;
  const shape = [-11, 5, 6];
  const rot = Math.floor(stream(seed, label, "mentor-order")() * mentors.length);
  const targets_ = mentors.map((_, i) => Math.round(total / mentors.length) + (shape[(i + rot) % mentors.length] ?? 0));
  targets_[targets_.length - 1]! += total - targets_.reduce((a, b) => a + b, 0);
  const loadOf = new Map<string, number>(mentors.map((m) => [m, 0]));
  const final = new Map<string, string>();
  for (const s of input.students) if (s.excluded || s.keepMentor) { final.set(s.studentId, s.mentorId); loadOf.set(s.mentorId, (loadOf.get(s.mentorId) ?? 0) + 1); }
  const movable = input.students.filter((s) => !s.excluded && !s.keepMentor).sort((a, b) => a.semester - b.semester || a.section.localeCompare(b.section) || a.register.localeCompare(b.register));
  let cursor = 0;
  mentors.forEach((m, i) => {
    const want = i === mentors.length - 1 ? movable.length - cursor : Math.max(0, targets_[i]! - (loadOf.get(m) ?? 0));
    for (const s of movable.slice(cursor, cursor + want)) { final.set(s.studentId, m); loadOf.set(m, (loadOf.get(m) ?? 0) + 1); }
    cursor += want;
  });
  for (const s of movable) {
    const to = final.get(s.studentId)!;
    if (to !== s.mentorId) plan.mentorMoves.push({ studentId: s.studentId, from: s.mentorId, to });
  }

  // ---- Summary ------------------------------------------------------------
  const stat = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
    return { n: xs.length, mean: round1(m), sd: round1(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length, 1))) };
  };
  const byCourse: Record<string, ReturnType<typeof stat>> = {};
  for (const c of input.courses) byCourse[c.code] = stat(active.map((s) => coursePct.get(`${s.studentId}:${c.offeringId}`)!).filter((x) => x !== undefined));
  const overdue = new Map<string, number>();
  for (const s of active) overdue.set(s.studentId, input.courses.filter((c) => !s.submissionId[c.offeringId] && !plan.submissionInserts.some((x) => x.studentId === s.studentId && x.assignmentId === c.assignmentId)).length);
  plan.summary = {
    students: active.length, excluded: input.students.length - active.length,
    courseMarkPct: byCourse,
    inactivityDays: histogram([...inactivity.values()], [0, 1, 2, 3, 4, 5, 7, 10, 14, 20]),
    overdueAssignments: histogram([...overdue.values()], [0, 1, 2, 3]),
    mentorLoads: Object.fromEntries(mentors.map((m) => [m.slice(0, 8), loadOf.get(m)])),
    mentorMoves: plan.mentorMoves.length,
    invoices: plan.invoiceInserts.length, receipts: plan.payments.length,
  };
  return plan;
}

export function histogram(values: number[], edges: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  edges.forEach((lo, i) => { out[i === edges.length - 1 ? `${lo}+` : edges[i + 1]! - lo === 1 ? `${lo}` : `${lo}-${edges[i + 1]! - 1}`] = 0; });
  for (const v of values) {
    let idx = edges.length - 1;
    for (let i = 0; i < edges.length; i++) if (v < (edges[i + 1] ?? Infinity)) { idx = i; break; }
    const lo = edges[idx]!;
    const k = idx === edges.length - 1 ? `${lo}+` : edges[idx + 1]! - lo === 1 ? `${lo}` : `${lo}-${edges[idx + 1]! - 1}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
