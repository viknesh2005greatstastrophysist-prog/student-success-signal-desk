import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { AuthorizationError } from "../lib/security";
import { executePlan, lockPlan, savePlan, savePlannedPlan, setReviewPaused } from "../lib/chapter11/service";
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
