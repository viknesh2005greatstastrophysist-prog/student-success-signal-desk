import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { AuthorizationError } from "../lib/security";
import { executePlan, lockPlan, safeJobRow, safeValidation, savePlan, savePlannedPlan, setReviewPaused } from "../lib/chapter11/service";
import { loadPlanningScope, planWithAgent } from "../lib/chapter11/planning";
import { editDraft, recordOutcome } from "../lib/chapter11/review";

/** E2E log #12: the department head and the AI-activity (governance) workspace
 * observe plans and never create, revise, lock, run or pause them. The Core
 * rejects those commands from every role but the assigned mentor, before any
 * database access, so this needs no database. The opt-in database suites assert
 * the same against real data, plus that the mentor's own commands still work. */

const actorAs = (role: ActorContext["role"]): ActorContext => ({
  subject: `${role}@aura.invalid`,
  role,
  personId: randomUUID(),
  departmentId: randomUUID(),
  ...(role === "student" ? { studentId: randomUUID() } : {}),
});
const notPermitted = (role: string) => (error: unknown) =>
  error instanceof AuthorizationError && error.message === `Role ${role} is not permitted for this operation`;

const input = { request: "Review my mentees' attendance", studentIds: [randomUUID()], domain: "attendance" as const, policyId: randomUUID() };

for (const role of ["hod", "governance", "student", "parent"] as const) {
  test(`${role} cannot create, revise, lock, run or pause a review plan, edit a draft or record an outcome`, async () => {
    const actor = actorAs(role);
    const planId = randomUUID();
    const commands: Record<string, () => Promise<unknown>> = {
      "create a plan with the planner": () => planWithAgent(actor, input, { commandId: randomUUID() }),
      "revise a plan with the planner": () =>
        planWithAgent(actor, input, { id: planId, expectedRevision: 1, commandId: randomUUID() }),
      "save a typed plan": () => savePlan(actor, input),
      "save a planned plan": () => savePlannedPlan(actor, { ...input, feedback: "", mode: "model" }),
      "lock a plan": () => lockPlan(actor, planId, 1),
      "run a plan": () => executePlan(actor, planId),
      "pause a plan": () => setReviewPaused(actor, planId, { paused: true, expectedRevision: 1, reason: "Not allowed" }),
      "read the planning scope": () => loadPlanningScope(actor),
      // review R-12: editing a draft and recording an outcome belong to the mentor too
      "edit a draft": () => editDraft(actor, randomUUID(), randomUUID(), {}),
      "record an outcome or withdraw a plan": () => recordOutcome(actor, randomUUID(), randomUUID(), {}),
    };
    for (const [name, run] of Object.entries(commands))
      await assert.rejects(run, notPermitted(role), `${role} must not ${name}`);
  });
}

test("the role gate sits in front of the plan commands, not only in the UI", async () => {
  // a malformed body from a read-only role is refused for its role first
  await assert.rejects(() => planWithAgent(actorAs("hod"), { not: "a plan" }), notPermitted("hod"));
  await assert.rejects(() => executePlan(actorAs("governance"), "not-a-uuid"), notPermitted("governance"));
  // the department head observes drafts and plans; it no longer edits or withdraws them
  await assert.rejects(() => editDraft(actorAs("hod"), randomUUID(), randomUUID(), {}), notPermitted("hod"));
  await assert.rejects(() => recordOutcome(actorAs("hod"), randomUUID(), randomUUID(), {}), notPermitted("hod"));
});

test("review R-01: the department head and AI activity get the review mechanics, never draft text", () => {
  const judge = {
    status: "scored",
    round: 2,
    scores: { grounding: 4, specificity: 4, actionability: 5, tone: 5 },
    reasons: { grounding: "The sentence 'Attend CS201 tutorials' cites 61% attendance" },
    mean: 4.5,
    min: 4,
    passed: true,
    provider: "groq",
    model: "openai/gpt-oss-120b",
    previous: { status: "scored", scores: { grounding: 2 }, reasons: { grounding: "Quotes the draft" }, repair: "applied" },
  };
  const shaped = safeValidation({
    valid: true,
    escalated: false,
    packetSchema: "packet-v2",
    checks: { alerts_cite_triggers: true, thresholds_faculty_set: null, note: "free text" },
    repairs: [{ attempt: 1, failures: [{ field: "actions" }], diagnoses: [{ diagnosis: "draft words" }] }],
    failures: [{ field: "actions", message: "draft words" }],
    diagnoses: [{ diagnosis: "draft words" }],
    modelAttempts: [{ attempt: 1, output: { summary: "draft words" } }],
    providerError: "draft words",
    judge,
    provenance: {
      provider: "groq",
      model: "qwen/qwen3.8-27b",
      tokens: 1200,
      fallbackReason: "provider failed: draft words",
      egress: [{ provider: "groq", model: "qwen", payloadHash: "abc", fields: ["evidence"], bytes: 10, outcome: "sent" }],
      judge,
      agent: {
        mode: "tools",
        turns: 1,
        toolCalls: [{ seq: 1, turn: 1, tool: "attendance_by_course", args: { course: "CS201", below: 61 }, status: "ok", resultHash: "h" }],
      },
    },
  })!;
  assert.equal(shaped.valid, true);
  assert.equal(shaped.repairCount, 1);
  assert.deepEqual(shaped.checks, { alerts_cite_triggers: true, thresholds_faculty_set: null });
  for (const key of ["repairs", "failures", "diagnoses", "modelAttempts", "providerError"]) assert.equal(key in shaped, false, key);
  const text = JSON.stringify(shaped);
  assert.equal(text.includes("draft words"), false);
  assert.equal(text.includes("Quotes the draft"), false);
  assert.equal(text.includes("CS201"), false);
  assert.equal(text.includes("reasons"), false);
  const prov = shaped.provenance as { model: string; egress: Array<{ payloadHash: string }>; agent: { toolCalls: unknown[] } };
  assert.equal(prov.model, "qwen/qwen3.8-27b");
  assert.equal(prov.egress[0].payloadHash, "abc");
  assert.deepEqual(prov.agent.toolCalls, [{ seq: 1, turn: 1, tool: "attendance_by_course", status: "ok" }]);
  const shapedJudge = shaped.judge as { mean: number; previous: { repair: string } };
  assert.equal(shapedJudge.mean, 4.5);
  assert.equal(shapedJudge.previous.repair, "applied");
  assert.equal(safeValidation(null), null);
});

test("review R-09: other roles learn whether a review flagged the student, never the score", () => {
  const risk = { score: 72, band: "high", flagged: true, signals: [{ explanation: "Attendance 61% in CS201" }] };
  const flagged = safeJobRow({ id: "j1", status: "awaiting_faculty", risk });
  assert.equal(flagged.flagged, true);
  assert.equal(flagged.risk, null);
  assert.ok(!JSON.stringify(flagged).includes("72") && !JSON.stringify(flagged).includes("CS201"));
  assert.equal(safeJobRow({ id: "j2", status: "not_flagged", risk: { ...risk, flagged: false } }).flagged, false);
  // Stopped before the risk check: no analysis, so not flagged.
  for (const status of ["blocked", "failed"])
    assert.equal(safeJobRow({ id: "j3", status, risk: null }).flagged, false);
});

test("review R-01: stop reasons stay with the assigned mentor; other roles get how many there were", () => {
  const reasons = ["Attendance 61% in CS201 is below the 75% threshold", "Marks for CS202 are missing"];
  const blocked = safeJobRow({
    id: "j4",
    status: "blocked",
    risk: null,
    failure_diagnosis: { code: "DATA_BLOCKED", attempts: 1, reasons },
    failure_reasons: reasons,
  });
  assert.deepEqual(blocked.failure_diagnosis, { code: "DATA_BLOCKED", attempts: 1, reasonCount: 2 });
  assert.deepEqual(blocked.failure_reasons, []);
  assert.equal(blocked.failure_reason_count, 2);
  const text = JSON.stringify(blocked);
  for (const leak of ["CS201", "CS202", "61%", "threshold"]) assert.equal(text.includes(leak), false, leak);
  // An escalated job's diagnosis is its validation report: the shaped report, with the repair count.
  const escalated = safeJobRow({
    id: "j5",
    status: "needs_human",
    risk: null,
    failure_diagnosis: { valid: false, escalated: true, repairs: [{ attempt: 1 }, { attempt: 2 }], failures: [{ field: "actions", message: "draft words" }] },
    failure_reasons: [],
  });
  assert.equal((escalated.failure_diagnosis as { repairCount: number }).repairCount, 2);
  assert.equal(escalated.failure_reason_count, 0);
  assert.equal(JSON.stringify(escalated).includes("draft words"), false);
  // A lease that ran out stores no reasons; a job that never stopped has no diagnosis.
  assert.deepEqual(
    safeJobRow({ id: "j6", status: "needs_human", failure_diagnosis: { code: "LEASE_EXPIRED", attempts: 3, reasons: [] } }).failure_diagnosis,
    { code: "LEASE_EXPIRED", attempts: 3, reasonCount: 0 },
  );
  const plain = safeJobRow({ id: "j7", status: "not_flagged", risk: null });
  assert.equal(plain.failure_diagnosis, null);
  assert.equal(plain.failure_reason_count, 0);
});
