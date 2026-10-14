import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  GRADED_FLOOR,
  demoPolicy,
  gradedPoints,
  policySchema,
  riskAnalysis,
  sourceNames,
  type Evidence,
  type Policy,
} from "../lib/chapter11/engine";

const student = randomUUID();
function evidence(values: {
  attendancePct: number;
  markPct: number;
  inactivityDays: number;
  overdueAssignments: number;
  missedMilestones: number;
  missedActivities: number;
}): Evidence {
  return Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source,
        studentId: student,
        recordId: `SYNTHETIC-${source}`,
        observedAt: "2026-10-12T00:00:00.000Z",
        semester: "2026-ODD",
        state: "present",
        synthetic: true,
        values:
          source === "academic"
            ? { attendancePct: values.attendancePct, markPct: values.markPct }
            : source === "lms"
              ? {
                  inactivityDays: values.inactivityDays,
                  overdueAssignments: values.overdueAssignments,
                }
              : source === "internship"
                ? { missedMilestones: values.missedMilestones }
                : { missedActivities: values.missedActivities },
      },
    ]),
  ) as unknown as Evidence;
}
const calm = {
  attendancePct: 90,
  markPct: 80,
  inactivityDays: 1,
  overdueAssignments: 0,
  missedMilestones: 0,
  missedActivities: 0,
};
const graded: Policy = { ...demoPolicy, version: "TEST-GRADED", severity: "graded" };

test("an existing policy without a severity still scores in whole weights", () => {
  const parsed = policySchema.parse({ ...demoPolicy, severity: undefined });
  assert.equal(parsed.severity, undefined);
  const worst = riskAnalysis(
    evidence({ ...calm, attendancePct: 74, markPct: 59 }),
    parsed,
  );
  assert.deepEqual(
    worst.signals.map((s) => s.points),
    [demoPolicy.attendanceWeight, demoPolicy.markWeight],
  );
  assert.equal(worst.score, 40);
});

test("graded points are the floor at the threshold and the full weight far beyond it", () => {
  assert.equal(gradedPoints(20, 74.99, 75, true), Math.round(20 * GRADED_FLOOR));
  assert.equal(gradedPoints(20, 75 * 0.5, 75, true), 20);
  assert.equal(gradedPoints(20, 0, 75, true), 20);
  assert.equal(gradedPoints(20, 7, 7, false), Math.round(20 * GRADED_FLOOR));
  assert.equal(gradedPoints(20, 21, 7, false), 20);
  assert.equal(gradedPoints(20, 90, 7, false), 20);
  assert.equal(gradedPoints(10, 1, 1, false), Math.round(10 * GRADED_FLOOR));
  assert.equal(gradedPoints(10, 3, 1, false), 10);
});

test("graded points never fall as the value moves further past the threshold", () => {
  let last = -1;
  for (let attendance = 74; attendance >= 0; attendance -= 1) {
    const points = gradedPoints(20, attendance, 75, true);
    assert.ok(points >= last, `attendance ${attendance}`);
    assert.ok(points <= 20);
    last = points;
  }
  last = -1;
  for (let days = 7; days <= 60; days += 1) {
    const points = gradedPoints(20, days, 7, false);
    assert.ok(points >= last, `days ${days}`);
    assert.ok(points <= 20);
    last = points;
  }
});

test("the same signals earn different scores as severity differs", () => {
  const mild = riskAnalysis(
    evidence({ ...calm, attendancePct: 65, markPct: 52, inactivityDays: 10 }),
    graded,
  );
  const severe = riskAnalysis(
    evidence({ ...calm, attendancePct: 38, markPct: 28, inactivityDays: 24 }),
    graded,
  );
  assert.deepEqual(mild.signals.map((s) => s.code), severe.signals.map((s) => s.code));
  assert.ok(mild.score < severe.score);
  assert.equal(mild.band, "medium");
  assert.equal(severe.band, "high");
  const fixed = riskAnalysis(
    evidence({ ...calm, attendancePct: 65, markPct: 52, inactivityDays: 10 }),
    demoPolicy,
  );
  assert.equal(fixed.score, 60, "fixed scoring still gives the whole weights");
  assert.ok(mild.score < fixed.score);
});

test("graded scoring keeps the faculty-set thresholds, the cap and the review flag", () => {
  const nothing = riskAnalysis(evidence(calm), graded);
  assert.equal(nothing.score, 0);
  assert.equal(nothing.band, "low");
  assert.equal(nothing.flagged, false);
  const everything = riskAnalysis(
    evidence({
      attendancePct: 0,
      markPct: 0,
      inactivityDays: 90,
      overdueAssignments: 9,
      missedMilestones: 9,
      missedActivities: 9,
    }),
    graded,
  );
  assert.equal(everything.score, 100);
  assert.equal(everything.signals.length, 6);
  assert.equal(everything.reviewRequired, true);
  assert.equal(everything.policyVersion, "TEST-GRADED");
  // A value exactly at the threshold does not trigger a "below" signal.
  assert.equal(
    riskAnalysis(evidence({ ...calm, attendancePct: 75 }), graded).signals.length,
    0,
  );
  // The explanation a draft must cite is identical under both scorings.
  const g = riskAnalysis(evidence({ ...calm, attendancePct: 50 }), graded);
  const f = riskAnalysis(evidence({ ...calm, attendancePct: 50 }), demoPolicy);
  assert.equal(g.signals[0]!.explanation, f.signals[0]!.explanation);
});

test("scores spread across the range for varied evidence", () => {
  const scores = new Set<number>();
  for (let attendance = 30; attendance <= 100; attendance += 10)
    for (let mark = 25; mark <= 95; mark += 10)
      for (const days of [0, 3, 9, 15, 25])
        scores.add(
          riskAnalysis(
            evidence({ ...calm, attendancePct: attendance, markPct: mark, inactivityDays: days }),
            graded,
          ).score,
        );
  assert.ok(scores.size >= 15, `only ${scores.size} distinct scores`);
});
