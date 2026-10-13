import assert from "node:assert/strict";
import test from "node:test";
import { editDistance, evaluationMetrics } from "../lib/chapter11/metrics";
test("Evaluation distinguishes pending, repaired, escalated and edited decisions", () => {
  const common = {
    plan_id: "cycle",
    mode: "deterministic",
    status: "awaiting_faculty",
  };
  const m = evaluationMetrics([
    { ...common, id: "pending", validation: { valid: true } },
    {
      ...common,
      id: "edited",
      validation: { valid: true, repairs: [1] },
      decision: "approved",
      artifact_version: 2,
      first_packet: { summary: "one" },
      approved_packet: { summary: "two" },
      first_created: "2026-01-01T00:00:00Z",
      decided_at: "2026-01-01T00:01:00Z",
    },
    {
      ...common,
      id: "fault",
      status: "needs_human",
      validation: { valid: false, fallback: true, escalated: true },
    },
  ]);
  assert.equal(m.cycles[0]!.validationPassRate, 2 / 3);
  assert.equal(m.cycles[0]!.decidedRuns, 1);
  assert.equal(m.cycles[0]!.averageDecisionSeconds, 60);
  assert.equal(m.cycles[0]!.approveAsIsRate, 0);
  assert.ok(m.cycles[0]!.averageMentorEditDistance! > 0);
  assert.equal(m.perRun[0]!.timeToDecisionSeconds, null);
  assert.equal(editDistance({ x: 1 }, { x: 1 }), 0);
});
