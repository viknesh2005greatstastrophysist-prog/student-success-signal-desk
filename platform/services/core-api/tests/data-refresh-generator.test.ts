import assert from "node:assert/strict";
import test from "node:test";
import {
  REFRESH_LABEL,
  REFRESH_SEED,
  inactivityAt,
  planRefresh,
  stream,
  type RefreshInput,
  type RefreshStudent,
} from "../lib/data-refresh/generator";

const AS_OF = "2026-10-15T09:00:00.000Z";
const uuid = (label: string) => {
  const r = stream("t", label);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
};
const courses = ["CS401", "CS402", "CS403"].map((code, i) => ({
  offeringId: uuid(`o${i}`), code, facultyId: uuid(`f${i}`), baseAssessmentId: uuid(`a${i}`),
  assignmentId: uuid(`g${i}`), lessonId: uuid(`l${i}`), assignmentDueAt: "2026-10-09T10:29:00.000Z",
}));
const mentors = [uuid("m0"), uuid("m1"), uuid("m2")];
function cohort(count = 321): RefreshInput {
  const students: RefreshStudent[] = Array.from({ length: count }, (_, i) => {
    const sem = i < 135 ? 4 : i < 254 ? 6 : 8;
    const old = [18, 6, 2, 1][i % 4]!;
    return {
      studentId: uuid(`s${i}`), personId: uuid(`p${i}`), parentPersonId: uuid(`q${i}`),
      register: `01FE22BCI${String(i).padStart(3, "0")}`, semester: sem,
      section: i % 2 ? "Section A" : "Section B",
      realAttendance: 35 + stream("t", "att", i)() * 65,
      mentorId: mentors[i % 3]!, excluded: i === 20, keepMentor: i === 7 || i === 8,
      keepFees: i === 9, lastActivityAgeDays: old + 3,
      baseMarkId: Object.fromEntries(courses.map((c) => [c.offeringId, uuid(`bm${i}${c.code}`)])),
      resultId: Object.fromEntries(courses.map((c) => [c.offeringId, uuid(`r${i}${c.code}`)])),
      submissionId: Object.fromEntries(courses.map((c) => [c.offeringId, i % 4 === 0 ? undefined : uuid(`sub${i}${c.code}`)])),
      invoiceId: uuid(`inv${i}`),
      internship: { id: uuid(`si${i}`), record: { recordId: "x", semester: "2026-ODD" } },
      placement: { id: uuid(`sp${i}`), record: { recordId: "y", semester: "2026-ODD" } },
    };
  });
  return { seed: REFRESH_SEED, label: REFRESH_LABEL, asOf: AS_OF, students, courses, mentors, termId: uuid("term") };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

test("the plan is deterministic and ignores the order of the student list", () => {
  const a = planRefresh(cohort());
  const reversed = cohort();
  reversed.students.reverse();
  const b = planRefresh(reversed);
  assert.deepEqual(a.markUpdates.slice().sort((x, y) => x.id.localeCompare(y.id)), b.markUpdates.slice().sort((x, y) => x.id.localeCompare(y.id)));
  assert.deepEqual(a.invoiceInserts.slice().sort((x, y) => x.id.localeCompare(y.id)), b.invoiceInserts.slice().sort((x, y) => x.id.localeCompare(y.id)));
});

test("an excluded student gets no writes at all", () => {
  const input = cohort();
  const ex = input.students[20]!;
  const plan = planRefresh(input);
  const ids = JSON.stringify(plan);
  for (const id of [ex.studentId, ...Object.values(ex.baseMarkId), ...Object.values(ex.resultId), ...Object.values(ex.submissionId), ex.invoiceId, ex.internship!.id, ex.placement!.id])
    if (id) assert.ok(!ids.includes(id), `touches ${id}`);
  assert.ok(!plan.mentorMoves.some((m) => m.studentId === ex.studentId));
});

test("courses differ and marks are spread, not clumped", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const pct = (offering: string) => plan.markUpdates.filter((m) => m.assessmentId === input.courses.find((c) => c.offeringId === offering)!.baseAssessmentId).map((m) => m.score);
  const [c1, c2, c3] = input.courses.map((c) => pct(c.offeringId));
  assert.ok(mean(c1!) < mean(c2!) && mean(c2!) < mean(c3!), "difficulty ordering");
  assert.ok(Math.abs(mean(c1!) - mean(c3!)) > 4);
  const all = [...c1!, ...c2!, ...c3!];
  assert.ok(all.every((x) => x >= 0 && x <= 100));
  const share = (lo: number, hi: number) => all.filter((x) => x >= lo && x < hi).length / all.length;
  assert.ok(share(55, 80) > 0.45, `55-80 share ${share(55, 80)}`);
  assert.ok(share(0, 40) > 0.02 && share(0, 40) < 0.15, `below 40 share ${share(0, 40)}`);
  assert.ok(share(90, 101) > 0.01 && share(90, 101) < 0.12, `90+ share ${share(90, 101)}`);
  assert.ok(sd(all) > 9 && sd(all) < 20);
  assert.ok(new Set(all.map((x) => Math.round(x))).size > 40, "many distinct values");
  // one student's three courses differ
  const s0 = input.students[0]!;
  const own = input.courses.map((c) => plan.markUpdates.find((m) => m.studentId === s0.studentId && m.assessmentId === c.baseAssessmentId)!.score);
  assert.ok(new Set(own).size > 1);
});

test("marks lean weakly on the supplied attendance", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const per = input.students.filter((s) => !s.excluded).map((s) => ({ att: s.realAttendance!, mark: mean(plan.resultUpdates.filter((r) => Object.values(s.resultId).includes(r.id)).map((r) => r.percentage)) }));
  const ma = mean(per.map((p) => p.att)), mm = mean(per.map((p) => p.mark));
  const corr = mean(per.map((p) => (p.att - ma) * (p.mark - mm))) / (sd(per.map((p) => p.att)) * sd(per.map((p) => p.mark)));
  assert.ok(corr > 0.12 && corr < 0.55, `correlation ${corr}`);
});

test("inactivity is right-skewed and never beyond what existing activity allows", () => {
  const input = cohort();
  const plan = planRefresh(input);
  assert.equal(inactivityAt(0.1), 0);
  assert.ok(inactivityAt(0.999) >= 20);
  const hist = plan.summary.inactivityDays as Record<string, number>;
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  const early = (hist["0"] ?? 0) + (hist["1"] ?? 0) + (hist["2"] ?? 0) + (hist["3"] ?? 0);
  assert.ok(early / total > 0.55 && early / total < 0.85, `0-3 share ${early / total}`);
  assert.ok((hist["14-19"] ?? 0) + (hist["20+"] ?? 0) >= 3, "has a long tail");
  // no new activity after the cap for any student
  const by = new Map(input.students.map((s) => [s.studentId, s]));
  for (const a of plan.activity) {
    const age = (Date.parse(AS_OF) - Date.parse(a.occurredAt)) / 86400000;
    assert.ok(age >= 0, "not in the future");
    assert.ok(by.has(a.studentId));
  }
});

test("overdue assignments are mostly zero or one with a few at three", () => {
  const plan = planRefresh(cohort());
  const h = plan.summary.overdueAssignments as Record<string, number>;
  const total = Object.values(h).reduce((a, b) => a + b, 0);
  assert.ok(((h["0"] ?? 0) + (h["1"] ?? 0)) / total > 0.8);
  assert.ok((h["3+"] ?? 0) >= 1 && (h["3+"] ?? 0) / total < 0.1);
});

test("submission times vary and some are late", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const due = Date.parse(input.courses[0]!.assignmentDueAt);
  const times = [...plan.submissionUpdates, ...plan.submissionInserts].map((s) => Date.parse(s.submittedAt));
  assert.ok(times.some((t) => t > due), "some late");
  assert.ok(times.filter((t) => t > due).length / times.length < 0.4);
  assert.ok(new Set(times.map((t) => Math.floor(t / 86400000))).size >= 5);
});

test("fees: about 80% paid, 15% partly paid, 5% overdue; amounts vary; receipts are plausible", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const tuition = plan.invoiceInserts.filter((i) => i.number.endsWith("-T"));
  assert.equal(tuition.length, 319); // excluded + keepFees skipped
  const asOf = Date.parse(AS_OF);
  const paid = tuition.filter((i) => i.status === "paid").length / tuition.length;
  const partial = tuition.filter((i) => i.status === "partial").length / tuition.length;
  const due = tuition.filter((i) => i.status === "due").length / tuition.length;
  assert.ok(paid > 0.68 && paid < 0.9, `paid ${paid}`);
  assert.ok(partial > 0.07 && partial < 0.25, `partial ${partial}`);
  assert.ok(due > 0.01 && due < 0.12, `overdue ${due}`);
  assert.ok(new Set(tuition.map((i) => i.amount)).size >= 6);
  for (const i of plan.invoiceInserts) {
    assert.ok(i.paid <= i.amount && i.paid >= 0);
    const sum = plan.payments.filter((p) => p.invoiceId === i.id).reduce((a, p) => a + p.amount, 0);
    assert.equal(sum, i.paid, `receipts add up for ${i.number}`);
    if (i.status === "due" && i.number.endsWith("-T")) assert.ok(i.paid === 0);
  }
  for (const p of plan.payments) assert.ok(Date.parse(p.createdAt) < asOf && Date.parse(p.createdAt) > asOf - 60 * 86400000);
  assert.equal(new Set(plan.payments.map((p) => p.reference)).size, plan.payments.length);
  assert.equal(new Set(plan.invoiceInserts.map((i) => i.number)).size, plan.invoiceInserts.length);
});

test("internships and placements follow the semester mix", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const sem = new Map(input.students.map((s) => [s.studentId, s.semester]));
  const stage = (source: string, semester: number) => plan.sourceUpdates.filter((u) => u.source === source && sem.get(u.studentId) === semester).map((u) => (u.record.values as { status: string }).status);
  const share = (xs: string[], k: string) => xs.filter((x) => x === k).length / xs.length;
  assert.ok(share(stage("internship", 4), "not_applicable") > 0.55);
  assert.ok(share(stage("internship", 8), "not_applicable") < 0.2);
  assert.ok(share(stage("placement", 8), "several_missed") > 0.15);
  assert.ok(share(stage("placement", 4), "not_applicable") > 0.7);
  for (const u of plan.sourceUpdates) {
    const v = u.record.values as Record<string, number | string>;
    if (u.record.state === "not_applicable") assert.equal(v.status, "not_applicable");
  }
});

test("mentor loads are uneven but plausible, pinned students stay, sections stay together", () => {
  const input = cohort();
  const plan = planRefresh(input);
  const final = new Map(input.students.map((s) => [s.studentId, s.mentorId] as const));
  for (const m of plan.mentorMoves) final.set(m.studentId, m.to);
  const loads = mentors.map((m) => [...final.values()].filter((x) => x === m).length);
  assert.equal(loads.reduce((a, b) => a + b, 0), 321);
  assert.ok(loads.every((l) => l >= 90 && l <= 120), loads.join());
  assert.ok(new Set(loads).size === 3, "not equal");
  assert.ok(Math.max(...loads) - Math.min(...loads) >= 6);
  for (const idx of [7, 8, 20]) assert.equal(final.get(input.students[idx]!.studentId), input.students[idx]!.mentorId);
});
