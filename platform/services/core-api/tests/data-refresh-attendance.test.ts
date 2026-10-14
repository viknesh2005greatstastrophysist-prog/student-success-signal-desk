import assert from "node:assert/strict";
import test from "node:test";
import { normal, stream } from "../lib/data-refresh/generator";
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_SEED,
  fallbackAnchor,
  planAttendance,
  priorClassDates,
  type AttendanceInput,
} from "../lib/data-refresh/attendance";

const uuid = (label: string) => {
  const r = stream("t", label);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
};
const OLD_PRESENT = [4, 6, 8, 9];
const DATES = Array.from({ length: 10 }, (_, i) => `2026-10-${String(2 + i).padStart(2, "0")}`);

function cohort(count = 321, withMissing = true): AttendanceInput {
  const courses = ["CS401", "CS402", "CS403"].map((code, i) => ({
    offeringId: uuid(`o${i}`), code, facultyId: uuid(`f${i}`),
    sessions: DATES.map((date, d) => ({ id: uuid(`s${i}:${d}`), date, topic: `Agentic AI and Decision Systems: seminar ${d + 1}` })),
  }));
  const students = Array.from({ length: count }, (_, i) => {
    const r = stream("cohort", String(i));
    // Left-skewed like the supplied report: many near the top, a tail below 50, some at 100.
    const anchor = withMissing && i === 7 ? null : Math.min(100, Math.max(0, 80 + normal(r) * 17 - (r() < 0.12 ? 35 : 0)));
    const old = OLD_PRESENT[i % 4]!;
    const records: Record<string, { id: string; status: string }> = {};
    courses.forEach((c, ci) => c.sessions.forEach((s, d) => { records[s.id] = { id: uuid(`r${i}:${ci}:${d}`), status: d < old ? "present" : "absent" }; }));
    return { studentId: uuid(`st${i}`), register: `01FE22BCI${String(i).padStart(3, "0")}`, excluded: i === 3, anchor, anchorCells: anchor === null ? 0 : 5, records };
  });
  return { seed: ATTENDANCE_SEED, label: ATTENDANCE_LABEL, asOf: "2026-10-14T21:15:00.000Z", courses, students };
}
const pctOf = (input: AttendanceInput, plan: ReturnType<typeof planAttendance>, studentId: string, offeringId: string) => plan.planned.get(`${studentId}:${offeringId}`)!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

test("class dates skip Sundays and end before the first existing session", () => {
  const dates = priorClassDates("2026-10-02", 30);
  assert.equal(dates.length, 30);
  assert.ok(dates.every((d) => d < "2026-10-02"));
  assert.ok(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0));
  assert.equal(new Set(dates).size, 30);
  assert.deepEqual([...dates].sort(), dates);
});

test("the plan is deterministic and one student's draws do not depend on the others", () => {
  const input = cohort();
  const a = planAttendance(input);
  const b = planAttendance(cohort());
  assert.deepEqual(a.recordInserts, b.recordInserts);
  assert.deepEqual(a.recordUpdates, b.recordUpdates);
  const fewer = cohort();
  fewer.students = fewer.students.filter((s) => s.studentId !== input.students[10]!.studentId);
  const c = planAttendance(fewer);
  const keep = input.students[20]!.studentId;
  assert.deepEqual(a.recordInserts.filter((r) => r.studentId === keep), c.recordInserts.filter((r) => r.studentId === keep));
});

test("an excluded student (student 021) gets no write of any kind", () => {
  const input = cohort();
  const out = input.students.find((s) => s.excluded)!;
  const plan = planAttendance(input);
  assert.ok(!plan.recordInserts.some((r) => r.studentId === out.studentId));
  const outRecordIds = new Set(Object.values(out.records).map((r) => r.id));
  assert.ok(!plan.recordUpdates.some((r) => outRecordIds.has(r.id)));
  assert.ok(!plan.planned.has(`${out.studentId}:${input.courses[0]!.offeringId}`));
  assert.equal(plan.summary.excluded, 1);
});

test("forty sessions per course, new class days before the old ones, valid statuses", () => {
  const input = cohort();
  const plan = planAttendance(input);
  assert.equal(plan.summary.sessionsPerCourse, 40);
  assert.equal(plan.sessionInserts.length, 90);
  assert.ok(plan.sessionInserts.every((s) => s.date < DATES[0]!));
  assert.equal(plan.recordInserts.length, 320 * 3 * 30);
  assert.ok(plan.recordInserts.every((r) => ["present", "late", "absent", "excused"].includes(r.status)));
  assert.ok(plan.recordUpdates.every((r) => ["present", "late", "absent", "excused"].includes(r.status)));
  assert.equal(new Set(plan.recordInserts.map((r) => r.id)).size, plan.recordInserts.length);
});

test("percentages are continuous, differ by course and stay in 0 to 100", () => {
  const input = cohort();
  const plan = planAttendance(input);
  const active = input.students.filter((s) => !s.excluded);
  for (const c of input.courses) {
    const xs = active.map((s) => pctOf(input, plan, s.studentId, c.offeringId));
    assert.ok(xs.every((x) => x >= 0 && x <= 100));
    assert.ok(new Set(xs.map((x) => Math.round(x * 100))).size >= 25, `${c.code} has too few distinct values`);
  }
  const means = input.courses.map((c) => mean(active.map((s) => pctOf(input, plan, s.studentId, c.offeringId))));
  assert.ok(Math.max(...means) - Math.min(...means) >= 3, "courses should differ on average");
  const same = active.filter((s) => new Set(input.courses.map((c) => pctOf(input, plan, s.studentId, c.offeringId))).size === 1).length;
  assert.ok(same / active.length < 0.1, "most students should have different values in different courses");
});

test("a student's overall level stays close to the college anchor", () => {
  const input = cohort();
  const plan = planAttendance(input);
  const rows = input.students.filter((s) => !s.excluded).map((s) => ({
    anchor: plan.anchors.get(s.studentId)!.anchor,
    overall: mean(input.courses.map((c) => pctOf(input, plan, s.studentId, c.offeringId))),
  }));
  const gap = rows.map((r) => r.overall - r.anchor);
  assert.ok(Math.abs(mean(gap)) < 1.5, `mean gap ${mean(gap)}`);
  assert.ok(sd(gap) < 5, `gap sd ${sd(gap)}`);
  assert.ok(mean(gap.map(Math.abs)) < 4);
  const ma = mean(rows.map((r) => r.anchor)), mo = mean(rows.map((r) => r.overall));
  const corr = mean(rows.map((r) => (r.anchor - ma) * (r.overall - mo))) / (sd(rows.map((r) => r.anchor)) * sd(rows.map((r) => r.overall)));
  assert.ok(corr > 0.97, `correlation ${corr}`);
});

test("a student with no usable college value gets a generated anchor from the real distribution", () => {
  const input = cohort();
  const plan = planAttendance(input);
  const missing = input.students[7]!;
  const got = plan.anchors.get(missing.studentId)!;
  assert.equal(got.source, "generated");
  assert.ok(got.anchor >= 0 && got.anchor <= 100);
  assert.equal(plan.summary.anchorCoverage && (plan.summary.anchorCoverage as { generatedFallback: number }).generatedFallback, 1);
  const pool = input.students.filter((s) => s.anchor !== null).map((s) => s.anchor!);
  assert.equal(fallbackAnchor(ATTENDANCE_SEED, ATTENDANCE_LABEL, missing.studentId, pool), got.anchor);
  assert.throws(() => fallbackAnchor(ATTENDANCE_SEED, ATTENDANCE_LABEL, missing.studentId, []));
  const draws = Array.from({ length: 400 }, (_, i) => fallbackAnchor(ATTENDANCE_SEED, ATTENDANCE_LABEL, `x${i}`, pool));
  assert.ok(Math.abs(mean(draws) - mean(pool)) < 4 && Math.abs(sd(draws) - sd(pool)) < 5);
});
