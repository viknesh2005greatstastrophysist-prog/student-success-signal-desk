/**
 * Attendance for the three app courses (data refresh "realistic-v3").
 *
 * The attendance the app shows and scores is generated: ten sessions per course, four
 * present counts, the same in every course. This generation rebuilds it from the
 * supplied college data. A student's anchor is the mean of the numeric "Recorded
 * attendance" cells (0 to 100) in `project_dataset`; each course value is
 *
 *   anchor + course effect + student shift + noise, clipped to 0 to 100,
 *
 * and is turned into per-session records (present, late, absent, excused) on 40
 * sessions per course, so the percentage is no longer a four-step pattern.
 *
 * Pure and deterministic: the same seed, label, as-of time and inputs give the same
 * plan, and each student's draws depend only on that student's key. The supplied
 * college cells are only ever an input; nothing here writes them.
 */
import { histogram, normal, projectId, stream, type Rng } from "./generator";

export const ATTENDANCE_LABEL = "realistic-v3";
export const ATTENDANCE_SEED = "aura-realistic-data-v3";
/** Value of `evidence.academic.values.attendanceBasis` once the attendance is derived from the college report. */
export const ATTENDANCE_BASIS = "college_attendance_report";
/** Sessions added per course, on top of the ten generated ones (so 40 in all). */
export const NEW_SESSIONS_PER_COURSE = 30;
/** The supplied field the anchor is built from. */
export const ANCHOR_FIELD = "recorded attendance";

/** Courses differ a little in how well they are attended (effects sum to zero). */
export const COURSE_EFFECT: Record<string, number> = { CS401: -3, CS402: 0.5, CS403: 2.5 };
const STUDENT_SHIFT_SD = 2;
const COURSE_NOISE_SD = 5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const DAY = 86400000;

export type AttendanceCourse = {
  offeringId: string;
  code: string;
  /** Teacher of the course: recorded_by for the new records. */
  facultyId: string;
  /** Existing generated sessions of the course. */
  sessions: Array<{ id: string; date: string; topic: string }>;
};
export type AttendanceStudent = {
  studentId: string;
  register: string;
  excluded: boolean;
  /** Mean of the numeric "Recorded attendance" cells within 0 to 100, or null. */
  anchor: number | null;
  /** How many such cells the anchor is built from. */
  anchorCells: number;
  /** Existing records: session id -> record. */
  records: Record<string, { id: string; status: string }>;
};
export type AttendanceInput = {
  seed: string;
  label: string;
  asOf: string;
  courses: AttendanceCourse[];
  students: AttendanceStudent[];
};
export type AttendancePlan = {
  label: string;
  seed: string;
  asOf: string;
  sessionInserts: Array<{ id: string; offeringId: string; date: string; topic: string }>;
  recordInserts: Array<{ id: string; sessionId: string; studentId: string; status: string; recordedBy: string; recordedAt: string }>;
  recordUpdates: Array<{ id: string; status: string }>;
  /** Planned percentage per `${studentId}:${offeringId}` (attended / (held - excused)). */
  planned: Map<string, number>;
  anchors: Map<string, { anchor: number; source: "college" | "generated" }>;
  summary: Record<string, unknown>;
};

/** Population anchor for a student with no usable college value: a draw from the other students' anchors. */
export function fallbackAnchor(seed: string, label: string, studentId: string, pool: number[]): number {
  if (!pool.length) throw new Error("No usable college attendance values to draw a fallback from");
  const sorted = [...pool].sort((a, b) => a - b);
  const r = stream(seed, label, "anchor-fallback", studentId);
  const pos = r() * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const base = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  return round1(clamp(base + normal(r) * 2, 0, 100));
}

/** The `count` most recent dates before `before` (YYYY-MM-DD), Sundays skipped, oldest first. */
export function priorClassDates(before: string, count: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${before}T00:00:00Z`);
  while (out.length < count) {
    t -= DAY;
    const d = new Date(t);
    if (d.getUTCDay() === 0) continue;
    out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Autocorrelated unit-variance series: absences come in runs, not as independent coin tosses. */
function ar1(r: Rng, n: number, rho: number): number[] {
  const out: number[] = [];
  let x = normal(r);
  for (let i = 0; i < n; i++) {
    x = rho * x + Math.sqrt(1 - rho * rho) * normal(r);
    out.push(x);
  }
  return out;
}

const moments = (xs: number[]) => {
  const n = xs.length || 1;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n: xs.length, mean: round1(mean), sd: round1(sd) };
};

export function planAttendance(input: AttendanceInput): AttendancePlan {
  const { seed, label } = input;
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error("A valid as-of time is required");
  const key = (...parts: Array<string | number>) => projectId(seed, `${label}:${parts.join(":")}`);
  const active = input.students.filter((s) => !s.excluded);
  const pool = input.students.filter((s) => s.anchor !== null).map((s) => s.anchor!);

  const plan: AttendancePlan = {
    label, seed, asOf: input.asOf, sessionInserts: [], recordInserts: [], recordUpdates: [],
    planned: new Map(), anchors: new Map(), summary: {},
  };

  // Sessions: the same thirty new class days for every course, before the earliest existing one.
  const earliest = input.courses.flatMap((c) => c.sessions.map((s) => s.date)).sort()[0];
  if (!earliest) throw new Error("The courses have no attendance sessions to build on");
  const newDates = priorClassDates(earliest, NEW_SESSIONS_PER_COURSE);
  const allDates = new Map<string, Array<{ id: string; date: string; isNew: boolean }>>();
  for (const c of input.courses) {
    const known = new Set(c.sessions.map((s) => s.date));
    const prefix = (c.sessions[0]?.topic.match(/^(.*?):\s/)?.[1] ?? c.code).trim();
    const sessions: Array<{ id: string; date: string; isNew: boolean }> = c.sessions.map((s) => ({ id: s.id, date: s.date, isNew: false }));
    newDates.forEach((date, i) => {
      if (known.has(date)) throw new Error(`${c.code} already has a session on ${date}`);
      const id = key("session", c.offeringId, date);
      plan.sessionInserts.push({ id, offeringId: c.offeringId, date, topic: `${prefix}: class ${i + 1}` });
      sessions.push({ id, date, isNew: true });
    });
    allDates.set(c.offeringId, sessions.sort((a, b) => a.date.localeCompare(b.date)));
  }
  const dateIndex = new Map([...new Set([...allDates.values()].flatMap((s) => s.map((x) => x.date)))].sort().map((d, i) => [d, i]));

  const byStatus: Record<string, number> = { present: 0, late: 0, absent: 0, excused: 0 };
  let anchorFromCollege = 0, anchorFallback = 0;
  for (const s of active) {
    const own = s.anchor !== null;
    const anchor = own ? s.anchor! : fallbackAnchor(seed, label, s.studentId, pool);
    if (own) anchorFromCollege++; else anchorFallback++;
    plan.anchors.set(s.studentId, { anchor, source: own ? "college" : "generated" });
    const shift = normal(stream(seed, label, "att-shift", s.studentId)) * STUDENT_SHIFT_SD;
    // Days when the student was away from campus are shared across the courses.
    const shared = ar1(stream(seed, label, "att-days", s.studentId), dateIndex.size, 0.55);
    for (const c of input.courses) {
      const r = stream(seed, label, "att", s.studentId, c.offeringId);
      const sessions = allDates.get(c.offeringId)!;
      const target = clamp(anchor + (COURSE_EFFECT[c.code] ?? 0) + shift + normal(r) * COURSE_NOISE_SD, 0, 100);
      const excusedCount = target >= 99.5 || r() >= 0.18 ? 0 : r() < 0.3 ? 2 : 1;
      const counted = sessions.length - excusedCount;
      const attended = clamp(Math.round((target / 100) * counted), 0, counted);
      const absent = counted - attended;
      // Higher score = more likely to be an absence (shared days plus the course's own days).
      const own1 = ar1(r, sessions.length, 0.3);
      const score = sessions.map((x, j) => 0.62 * shared[dateIndex.get(x.date)!]! + 0.78 * own1[j]!);
      const order = sessions.map((_, j) => j).sort((a, b) => score[b]! - score[a]! || a - b);
      const status: string[] = new Array(sessions.length).fill("present");
      order.slice(0, absent).forEach((j) => { status[j] = "absent"; });
      order.slice(absent, absent + excusedCount).forEach((j) => { status[j] = "excused"; });
      status.forEach((v, j) => { if (v === "present" && r() < 0.05) status[j] = "late"; });
      plan.planned.set(`${s.studentId}:${c.offeringId}`, counted ? (attended / counted) * 100 : 0);
      sessions.forEach((x, j) => {
        byStatus[status[j]!] = (byStatus[status[j]!] ?? 0) + 1;
        if (x.isNew) {
          plan.recordInserts.push({
            id: key("record", s.studentId, x.id), sessionId: x.id, studentId: s.studentId, status: status[j]!,
            recordedBy: c.facultyId, recordedAt: input.asOf,
          });
        } else {
          const old = s.records[x.id];
          if (!old) throw new Error(`Student ${s.register} has no record for an existing session of ${c.code}`);
          if (old.status !== status[j]) plan.recordUpdates.push({ id: old.id, status: status[j]! });
        }
      });
    }
  }

  const byCourse: Record<string, ReturnType<typeof moments>> = {};
  for (const c of input.courses) byCourse[c.code] = moments(active.map((s) => plan.planned.get(`${s.studentId}:${c.offeringId}`)!));
  const overall = active.map((s) => input.courses.reduce((a, c) => a + plan.planned.get(`${s.studentId}:${c.offeringId}`)!, 0) / input.courses.length);
  const gap = active.map((s, i) => overall[i]! - plan.anchors.get(s.studentId)!.anchor);
  plan.summary = {
    students: active.length, excluded: input.students.length - active.length,
    anchorCoverage: {
      students: input.students.length, withCollegeValue: pool.length, fromCollege: anchorFromCollege, generatedFallback: anchorFallback,
    },
    sessionsPerCourse: (allDates.get(input.courses[0]!.offeringId) ?? []).length,
    sessionsAdded: plan.sessionInserts.length, recordsAdded: plan.recordInserts.length, recordsRevised: plan.recordUpdates.length,
    statusCounts: byStatus,
    plannedByCourse: byCourse,
    overallMinusAnchor: { ...moments(gap), meanAbs: round1(gap.reduce((a, b) => a + Math.abs(b), 0) / (gap.length || 1)) },
    plannedHistogram: histogram(overall.map((x) => Math.round(x)), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
    model: { courseEffect: COURSE_EFFECT, studentShiftSd: STUDENT_SHIFT_SD, courseNoiseSd: COURSE_NOISE_SD },
  };
  return plan;
}
