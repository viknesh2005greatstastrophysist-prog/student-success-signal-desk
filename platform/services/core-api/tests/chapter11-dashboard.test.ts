import test from "node:test";
import assert from "node:assert/strict";
import { compositeRiskView } from "../lib/chapter11/dashboard";
import {
  riskAnalysis,
  demoPolicy,
  type Evidence,
} from "../lib/chapter11/engine";
test("risk projection intersects authorized students, exposes reasoning before draft, and does not invent queued scores", () => {
  const evidence = {
    academic: { state: "present", values: { attendancePct: 40, markPct: 50 } },
    lms: {
      state: "present",
      values: { inactivityDays: 9, overdueAssignments: 1 },
    },
    internship: { state: "not_applicable" },
    placement: { state: "not_applicable" },
  } as unknown as Evidence;
  const risk = riskAnalysis(evidence, demoPolicy);
  const rows = compositeRiskView(
    [
      {
        id: "one",
        display_name: "Fixture Student",
        register_number: "TEST1",
        mentor_name: "Fixture Mentor",
      },
    ],
    [
      {
        id: "a",
        plan_id: "p",
        student_id: "one",
        status: "running",
        stage: "recommend",
        risk,
      },
      {
        id: "b",
        plan_id: "p",
        student_id: "peer",
        status: "running",
        stage: "risk",
        risk,
      },
      {
        id: "c",
        plan_id: "q",
        student_id: "one",
        status: "queued",
        stage: "collect",
      },
    ],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.score, risk.score);
  assert.deepEqual(rows[0]!.signals, risk.signals);
  assert.match(rows[0]!.reviewPath, /review.*before publication/i);
  assert.equal(rows[1]!.score, null);
  assert.equal(rows[1]!.flagged, false);
});

test("review R-17: a risk row carries the plan's intervention status, since the case stays approved after a withdrawal", () => {
  const students = [{ id: "one", display_name: "Fixture Student", register_number: "TEST1" }];
  const job = { id: "a", plan_id: "p", student_id: "one", status: "approved", stage: "publish" };
  assert.equal(compositeRiskView(students, [{ ...job, intervention_status: "withdrawn" }])[0]!.interventionStatus, "withdrawn");
  assert.equal(compositeRiskView(students, [job])[0]!.interventionStatus, null);
});
