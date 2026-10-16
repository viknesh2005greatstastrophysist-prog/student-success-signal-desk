import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { AuthorizationError } from "../lib/security";
import { executePlan, lockPlan, safeValidation, savePlan, savePlannedPlan, setReviewPaused } from "../lib/chapter11/service";
import { loadPlanningScope, planWithAgent } from "../lib/chapter11/planning";
import { editDraft } from "../lib/chapter11/review";

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
  test(`${role} cannot create, revise, lock, run or pause a review plan`, async () => {
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
    };
    for (const [name, run] of Object.entries(commands))
      await assert.rejects(run, notPermitted(role), `${role} must not ${name}`);
  });
}

test("the role gate sits in front of the plan commands, not only in the UI", async () => {
  // a malformed body from a read-only role is refused for its role first
  await assert.rejects(() => planWithAgent(actorAs("hod"), { not: "a plan" }), notPermitted("hod"));
  await assert.rejects(() => executePlan(actorAs("governance"), "not-a-uuid"), notPermitted("governance"));
  // the department head keeps the draft-edit oversight route, which is a separate command
  await assert.rejects(() => editDraft(actorAs("governance"), randomUUID(), randomUUID(), {}), notPermitted("governance"));
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
