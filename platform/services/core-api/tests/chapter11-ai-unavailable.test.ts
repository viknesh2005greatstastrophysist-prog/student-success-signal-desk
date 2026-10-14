import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { compose, type Composer, type PacketV2 } from "../lib/chapter11/engine";
import { buildPlannerAliases, runPlanner, type PlanningScope } from "../lib/chapter11/planner";
import { chainComposer, ModelLimiter, type Endpoint } from "../lib/chapter11/provider";
import { AI_UNAVAILABLE, AiUnavailableError, unavailableReasons } from "../lib/chapter11/unavailable";
import { evaluationMetrics } from "../lib/chapter11/metrics";
import { attendanceContext, downComposer, goodDraft, groqEndpoint } from "./agent-fixtures";
import { route, startMockOpenAI } from "./mock-openai-server";

/** C1: every review runs on AI. When every model fails there is no draft, the
 * case waits as "AI unavailable" with the reasons recorded, and the planner asks
 * for a retry. Stubs and the local mock server only; no live model. The durable
 * audit of this state (job status, event row) is asserted in the opt-in database
 * suite `chapter11-agents-database.test.ts`. */

const KEY = "TEST-SECRET-KEY-DO-NOT-LEAK";
const gemini = (base: string): Endpoint => ({ kind: "gemini", base, model: "gemini-test", key: KEY, remote: true, extra: {} });

test("when every provider in the chain fails, no draft exists and each reason is recorded", async () => {
  const groq = route({ status: 503, body: { error: { message: "overloaded" } } });
  const second = route({ status: 429, headers: { "retry-after": "30" }, body: { error: { message: "rate limited" } } });
  const server = await startMockOpenAI({ "/groq": groq, "/gemini": second });
  try {
    const chain = chainComposer(
      [{ ...groqEndpoint(server.url("/groq")), key: KEY }, gemini(server.url("/gemini"))],
      { limiter: new ModelLimiter(), maxWaitMs: 0 },
    )!;
    const result = await compose(attendanceContext(), chain);
    assert.equal(result.unavailable, true);
    assert.equal(result.mode, "unavailable");
    assert.equal(result.modelId, null, "nothing was drafted by a model");
    assert.equal(result.validation.valid, false, "a publish needs a passing validation, so no case can be created");
    assert.equal(result.validation.escalated, false, "this is a retry state, not a human-gate escalation");
    assert.equal(result.validation.fallback, false, "no template is substituted");
    assert.equal(result.validation.selection.selected, "none-ai-unavailable");
    assert.deepEqual(result.validation.modelAttempts, []);
    // both providers are named with their failure code, secret-free
    const reasons = unavailableReasons(result.validation.provenance);
    assert.equal(reasons.length >= 2, true);
    assert.match(reasons.join(" | "), /groq qwen\/qwen3\.8-27b: MODEL_HTTP_503/);
    assert.match(reasons.join(" | "), /gemini gemini-test: MODEL_HTTP_429/);
    assert.ok(!JSON.stringify(result.validation).includes(KEY), "no credential in the stored validation");
    // the privacy-guarded requests that were sent are still audited
    assert.ok(result.validation.provenance.egress.length >= 2);
    assert.ok(result.validation.provenance.egress.every((e) => e.outcome === "sent"));
  } finally {
    await server.close();
  }
});

test("with no model configured the review also waits, with its own reason", async () => {
  const result = await compose(attendanceContext());
  assert.equal(result.unavailable, true);
  assert.equal(result.validation.valid, false);
  assert.deepEqual(unavailableReasons(result.validation.provenance), ["MODEL_NOT_CONFIGURED"]);
});

test("an outage in the middle of a repair also waits for a retry instead of substituting the template", async () => {
  const context = attendanceContext();
  let calls = 0;
  const flaky: Composer = {
    modelId: "STUB-FLAKY",
    async generate(c) {
      if (calls++ === 0) {
        const bad = goodDraft(c) as PacketV2;
        bad.actions[0]!.personalisation = "Explain that the pattern suggests depression and arrange a diagnosis.";
        return bad;
      }
      throw new Error("MODEL_HTTP_503");
    },
  };
  const result = await compose(context, flaky);
  assert.equal(calls, 2, "one draft, one failed repair, then it stops");
  assert.equal(result.unavailable, true);
  assert.equal(result.validation.providerError, "MODEL_HTTP_503");
  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.repairs.length, 1, "the failing check and its diagnosis are kept");
  assert.equal(result.modelId, null);
});

test("a stub model that is down gives the same state as a failing chain", async () => {
  const result = await compose(attendanceContext(), downComposer("MODEL_TIMEOUT"));
  assert.equal(result.unavailable, true);
  assert.equal(result.validation.providerError, "MODEL_UNAVAILABLE");
});

test("the unavailable state is a retryable conflict carrying the audited reasons", () => {
  const error = new AiUnavailableError("No AI model answered", ["groq qwen/qwen3.8-27b: MODEL_HTTP_503"]);
  assert.equal(error.code, AI_UNAVAILABLE);
  assert.equal(error.status, 409, "an expected error: its message reaches the mentor");
  assert.deepEqual(error.reasons, ["groq qwen/qwen3.8-27b: MODEL_HTTP_503"]);
  const reasons = unavailableReasons({
    fallbacks: Array.from({ length: 12 }, (_, i) => ({ provider: "groq", model: `m${i}`, reason: "x".repeat(500) })),
    fallbackReason: "provider failed: MODEL_UNAVAILABLE",
  });
  assert.equal(reasons.length, 8);
  assert.ok(reasons.every((r) => r.length <= 300));
});

test("the planner has no rule-based fallback: when every model fails it returns nothing to save", async () => {
  const mine = Array.from({ length: 3 }, () => ({ id: randomUUID(), semester: 5, attendancePct: 60, markPct: 70, mentorId: randomUUID() }));
  const scope: PlanningScope = { students: mine, policies: [] };
  const down = route({ status: 503, body: { error: { message: "down" } } });
  const server = await startMockOpenAI({ "/m": down });
  try {
    const outcome = await runPlanner({
      request: "check my mentees whose attendance dropped",
      feedback: "",
      scope,
      pins: {},
      endpoints: [groqEndpoint(server.url("/m"))],
      options: { limiter: new ModelLimiter(), maxWaitMs: 0 },
      aliases: buildPlannerAliases(scope, "salt"),
    });
    assert.equal(outcome.resolution, undefined, "no parser produces a plan in its place");
    assert.match(String(outcome.summary.fallbackReason), /MODEL_HTTP_503/);
    assert.match(unavailableReasons(outcome.summary).join(" | "), /groq .*MODEL_HTTP_503/);
  } finally {
    await server.close();
  }
  const none = await runPlanner({ request: "check my mentees", feedback: "", scope, pins: {}, endpoints: [] });
  assert.equal(none.resolution, undefined);
  assert.deepEqual(unavailableReasons(none.summary), ["no model endpoint is configured"]);
});

test("metrics count retired rule-based runs as legacy and no new run can be one", () => {
  const rows = [
    { id: "a", plan_id: "p", status: "approved", mode: "deterministic", validation: { valid: true } },
    { id: "b", plan_id: "p", status: "awaiting_faculty", mode: "model", validation: { valid: true } },
  ];
  const cycle = evaluationMetrics(rows).cycles[0]!;
  assert.equal(cycle.legacyRuleRuns, 1);
  assert.equal(cycle.modelRuns, 1);
  assert.ok(!("ruleRuns" in cycle));
});
