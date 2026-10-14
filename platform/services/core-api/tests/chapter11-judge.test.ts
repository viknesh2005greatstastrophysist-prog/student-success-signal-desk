import assert from "node:assert/strict";
import test from "node:test";
import {
  compose,
  newCallMeta,
  type Composer,
  type GenerationContext,
  type PacketV2,
} from "../lib/chapter11/engine";
import { allowlistRepair, buildAliases } from "../lib/chapter11/egress";
import { createNodeRunner, type NodeTrace } from "../lib/chapter11/graph";
import {
  JUDGE_DIMENSIONS,
  judgeRequest,
  type JudgeRaw,
} from "../lib/chapter11/judge";
import { resetFaults } from "../lib/chapter11/faults";
import {
  chainComposer,
  ModelLimiter,
  type Endpoint,
} from "../lib/chapter11/provider";
import { quotaWaitSeconds } from "../lib/chapter11/unavailable";
import { route, startMockOpenAI } from "./mock-openai-server";
import {
  academicContext,
  goodDraft,
  groqEndpoint,
  ROSTER,
} from "./agent-fixtures";

/** Judge agent (E2E #35), limiter waits (#34) and the egress `reached` flag (#36).
 * Stubs and the local mock server only: no network, no database. */

const scores = (g: number, s = 4, a = 4, t = 4): JudgeRaw => ({
  grounding: { score: g, reason: "Each sentence states its cited value and threshold." },
  specificity: { score: s, reason: "Names the weakest course alias with its value." },
  actionability: { score: a, reason: "Actions are practical for a mentor." },
  tone: { score: t, reason: "Neutral and supportive." },
});

function stub(options: {
  judges: Array<JudgeRaw | Error>;
  repaired?: (context: GenerationContext) => PacketV2;
}) {
  const seen = {
    generate: [] as Array<{ failing: unknown; repair: unknown }>,
    judged: 0,
  };
  const composer: Composer = {
    modelId: "STUB",
    generate: async (context, failing, _prior, _meta, repair) => {
      seen.generate.push({ failing, repair });
      return failing && options.repaired
        ? options.repaired(context)
        : goodDraft(context);
    },
    judge: async () => {
      const next = options.judges[Math.min(seen.judged, options.judges.length - 1)]!;
      seen.judged++;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { composer, seen };
}
const prefixed = (c: GenerationContext) => {
  const draft = goodDraft(c);
  draft.rationale[0]!.text = `In short, ${draft.rationale[0]!.text}`;
  return draft;
};

test("a draft that passes the validator is judged once and a good score changes nothing", async () => {
  const { composer, seen } = stub({ judges: [scores(4)] });
  const trace: NodeTrace = {};
  const result = await compose(academicContext(), composer, createNodeRunner(trace));
  const judge = result.validation.judge!;
  assert.equal(judge.status, "scored");
  assert.equal(judge.passed, true);
  assert.deepEqual(judge.scores, { grounding: 4, specificity: 4, actionability: 4, tone: 4 });
  assert.equal(judge.mean, 4);
  assert.equal(judge.min, 4);
  assert.deepEqual(judge.low, []);
  assert.equal(seen.judged, 1);
  assert.equal(seen.generate.length, 1);
  assert.equal(result.validation.repairs.length, 0);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.provenance.judge, judge);
  assert.equal(trace.JudgeAgent?.status, "completed");
  assert.equal(trace.Regenerator, undefined);
});

test("a low dimension turns the judge's reasons into diagnoses for one targeted repair, then revalidates and rejudges", async () => {
  const { composer, seen } = stub({
    judges: [scores(2), scores(4)],
    repaired: prefixed,
  });
  const result = await compose(academicContext(), composer);
  assert.equal(seen.generate.length, 2);
  const second = seen.generate[1]!;
  assert.deepEqual(second.failing, [{ field: "rationale", code: "JUDGE_GROUNDING_LOW" }]);
  const repair = second.repair as Array<{ code: string; path: string; diagnosis: string; instruction: string }>;
  assert.equal(repair.length, 1);
  assert.equal(repair[0]!.code, "JUDGE_GROUNDING_LOW");
  assert.equal(repair[0]!.path, "rationale");
  assert.match(repair[0]!.diagnosis, /^Judge grounding 2 of 5: /);
  // what leaves the server passes the same repair guard as every other instruction
  assert.match(repair[0]!.instruction, /^rewrite rationale so every sentence/);
  assert.equal(allowlistRepair(repair)[0]!.instruction, repair[0]!.instruction);
  assert.equal(result.validation.repairs.length, 1);
  assert.equal(result.validation.repairs[0]!.source, "judge");
  const judge = result.validation.judge!;
  assert.equal(judge.round, 2);
  assert.equal(judge.passed, true);
  assert.equal(judge.previous?.round, 1);
  assert.equal(judge.previous?.repair, "applied");
  assert.equal(judge.previous?.scores?.grounding, 2);
  assert.equal(result.validation.valid, true);
  assert.ok(
    (result.packet as PacketV2).rationale[0]!.text.startsWith("In short, "),
    "the repaired sentence is the one that ships",
  );
});

test("a judge repair that fails the validator is discarded and the earlier valid draft stays", async () => {
  const { composer } = stub({
    judges: [scores(1, 4, 4, 4)],
    repaired: (c) => {
      const bad = goodDraft(c);
      bad.rationale[0]!.text = "Attendance was 41.7% in course-1 which is invented.";
      return bad;
    },
  });
  const result = await compose(academicContext(), composer);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.judge!.repair, "discarded");
  assert.equal(result.validation.judge!.round, 1);
  assert.ok(!(result.packet as PacketV2).rationale[0]!.text.includes("41.7"));
  assert.equal(result.validation.repairs.length, 1);
});

test("an unavailable judge is recorded and never blocks the draft", async () => {
  const { composer } = stub({ judges: [new Error("MODEL_HTTP_503")] });
  const trace: NodeTrace = {};
  const result = await compose(academicContext(), composer, createNodeRunner(trace));
  assert.equal(result.validation.judge!.status, "unavailable");
  assert.equal(result.validation.judge!.unavailableReason, "MODEL_HTTP_503");
  assert.equal(result.validation.valid, true);
  assert.equal(result.unavailable, false);
  assert.equal(result.mode, "model");
  assert.equal(trace.JudgeAgent?.status, "cancelled");
  assert.equal(result.validation.repairs.length, 0);
});

test("the judge never becomes the served model, and a composer without a judge is not judged", async () => {
  const { composer } = stub({ judges: [scores(5)] });
  const withJudge = await compose(academicContext(), composer);
  assert.equal(withJudge.modelId, "STUB");
  const plain = await compose(academicContext(), {
    modelId: "PLAIN",
    generate: async (c) => goodDraft(c),
  });
  assert.equal(plain.validation.judge, undefined);
  assert.equal(plain.validation.valid, true);
});

test("fault injection is off by default and, when the harness sets it, is audited as injected", async () => {
  const saved = process.env.CH11_FAULT_INJECT;
  try {
    delete process.env.CH11_FAULT_INJECT;
    resetFaults();
    const off = await compose(academicContext(), stub({ judges: [scores(4)] }).composer);
    assert.equal(off.validation.provenance.injected, undefined);
    assert.equal(off.validation.repairs.length, 0);

    process.env.CH11_FAULT_INJECT = "draft:1";
    resetFaults();
    const drafted = stub({ judges: [scores(4)] });
    const first = await compose(academicContext(), drafted.composer);
    assert.deepEqual(first.validation.provenance.injected, [
      { kind: "draft", note: "injected for testing" },
    ]);
    // the corrupted first draft failed the real validator and the real Regenerator ran
    assert.equal(first.validation.repairs.length, 1);
    assert.equal(first.validation.repairs[0]!.source, undefined);
    assert.ok(first.validation.repairs[0]!.diagnoses.length >= 1);
    assert.equal(first.validation.valid, true);
    // one-shot: the next case is untouched
    const next = await compose(academicContext(), stub({ judges: [scores(4)] }).composer);
    assert.equal(next.validation.provenance.injected, undefined);

    process.env.CH11_FAULT_INJECT = "judge";
    resetFaults();
    const judged = await compose(
      academicContext(),
      stub({ judges: [scores(5), scores(4)], repaired: prefixed }).composer,
    );
    assert.deepEqual(judged.validation.provenance.injected, [
      { kind: "judge", note: "injected for testing" },
    ]);
    assert.equal(judged.validation.judge!.previous?.injected, true);
    assert.match(judged.validation.judge!.previous!.reasons!.grounding, /^injected for testing/);
    assert.equal(judged.validation.judge!.previous?.repair, "applied");
  } finally {
    if (saved === undefined) delete process.env.CH11_FAULT_INJECT;
    else process.env.CH11_FAULT_INJECT = saved;
    resetFaults();
  }
});

/* -------- the real chain: anonymised request, Gemini fallback, reached flag -------- */

const withAliases = () => {
  const context = academicContext();
  return { ...context, aliases: buildAliases(context.evidence) };
};
const gemini = (base: string): Endpoint => ({
  kind: "gemini",
  base,
  model: "gemini-test",
  key: "TEST",
  remote: true,
  extra: {},
});
const verdictJson = JSON.stringify(scores(4));

test("the judge request carries the anonymised packet only, a strict schema and no tools", () => {
  const context = withAliases();
  const request = judgeRequest(groqEndpoint("http://x"), context, goodDraft(context));
  const wire = JSON.stringify(request.body);
  for (const secret of [...ROSTER.names, ...ROSTER.registers, ...ROSTER.emails])
    assert.ok(!wire.includes(secret));
  assert.ok(!("tools" in request.body));
  const format = request.body.response_format as { json_schema: { strict: boolean; name: string; schema: { required: string[] } } };
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, "draft_review");
  assert.deepEqual(format.json_schema.schema.required, [...JUDGE_DIMENSIONS]);
  const user = JSON.parse(
    (request.body.messages as Array<{ role: string; content: string }>)[1]!.content,
  ) as Record<string, unknown>;
  assert.deepEqual(Object.keys(user).sort(), ["case", "draft", "evidence", "policy", "risk", "signals", "specialist"]);
  assert.ok(request.fields.includes("draft.rationale[].text"));
});

test("the judge model answers, the fallback takes over when it fails, and both calls are audited with the reached flag", async () => {
  const groq = route({ status: 500, body: { error: "down" } });
  const fallback = route({ content: verdictJson });
  const server = await startMockOpenAI({ "/groq": groq, "/gemini": fallback });
  try {
    const judgeEndpoints = [groqEndpoint(server.url("/groq")), gemini(server.url("/gemini"))];
    const composer = chainComposer(judgeEndpoints, {
      judgeEndpoints,
      limiter: new ModelLimiter(),
      maxWaitMs: 0,
    })!;
    const context = withAliases();
    const meta = newCallMeta();
    const raw = await composer.judge!(context, goodDraft(context), meta);
    assert.equal(raw.grounding.score, 4);
    assert.equal(meta.provider, "gemini");
    assert.equal(meta.fallbacks[0]!.provider, "groq");
    assert.equal(meta.egress.length, 2);
    assert.ok(meta.egress.every((e) => e.outcome === "sent" && e.reached === true));
    assert.ok(
      JSON.stringify(groq.requests[0]!.body).includes("draft_review"),
      "the judge schema is what Groq received",
    );
  } finally {
    await server.close();
  }
});

test("an outbound request the limiter refuses passed the guard but never reached the provider (#36)", async () => {
  const groq = route({ content: verdictJson });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    const limiter = new ModelLimiter();
    limiter.reserve("groq:qwen/qwen3.8-27b", 7900);
    const endpoint = groqEndpoint(server.url("/groq"));
    const composer = chainComposer([endpoint], { judgeEndpoints: [endpoint], limiter, maxWaitMs: 0 })!;
    const context = withAliases();
    const meta = newCallMeta();
    await assert.rejects(composer.judge!(context, goodDraft(context), meta));
    assert.equal(groq.requests.length, 0);
    assert.equal(meta.egress.length, 1);
    assert.equal(meta.egress[0]!.outcome, "sent");
    assert.notEqual(meta.egress[0]!.reached, true);
  } finally {
    await server.close();
  }
});

/* ------------------------------ limiter waits (#34) ------------------------------ */

test("background work waits for the rate window instead of being refused", async () => {
  const groq = route({ content: verdictJson });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    let now = 0;
    const slept: number[] = [];
    const limiter = new ModelLimiter(() => now);
    limiter.reserve("groq:qwen/qwen3.8-27b", 7900);
    const endpoint = groqEndpoint(server.url("/groq"));
    const composer = chainComposer([endpoint], {
      judgeEndpoints: [endpoint],
      limiter,
      wait: "background",
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    })!;
    const context = withAliases();
    const meta = newCallMeta();
    const raw = await composer.judge!(context, goodDraft(context), meta);
    assert.equal(raw.tone.score, 4);
    assert.equal(groq.requests.length, 1);
    assert.equal(meta.fallbacks.length, 0);
    assert.ok(slept.reduce((a, b) => a + b, 0) >= 60000, "it slept through the whole window");
    assert.ok(slept.reduce((a, b) => a + b, 0) <= 70000, "and stayed inside the background allowance");
  } finally {
    await server.close();
  }
});

test("an interactive call waits briefly, then reports how long the quota wait is", async () => {
  const groq = route({ content: verdictJson });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    const now = 0;
    const slept: number[] = [];
    const limiter = new ModelLimiter(() => now);
    limiter.reserve("groq:qwen/qwen3.8-27b", 7900);
    const endpoint = groqEndpoint(server.url("/groq"));
    const composer = chainComposer([endpoint], {
      judgeEndpoints: [endpoint],
      limiter,
      wait: "interactive",
      sleep: async (ms) => void slept.push(ms),
    })!;
    const context = withAliases();
    const meta = newCallMeta();
    await assert.rejects(composer.judge!(context, goodDraft(context), meta), /MODEL_RATE_LIMITED/);
    assert.equal(groq.requests.length, 0);
    assert.deepEqual(slept, []);
    const reported = meta.fallbacks[0]!;
    assert.match(reported.reason, /needs a 60s wait/);
    assert.equal(reported.retryAfterMs, 60000);
    assert.equal(quotaWaitSeconds({ fallbacks: meta.fallbacks }), 61);
    // a real failure is not a quota wait
    assert.equal(
      quotaWaitSeconds({ fallbacks: [{ provider: "groq", model: "m", reason: "MODEL_HTTP_500" }] }),
      undefined,
    );
  } finally {
    await server.close();
  }
});

test("an HTTP 429 is retried once inside the allowance, and the daily cap still refuses at once", async () => {
  const groq = route(
    { status: 429, headers: { "retry-after": "2" }, body: { error: "slow down" } },
    { content: verdictJson },
  );
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    let now = 0;
    const slept: number[] = [];
    const limiter = new ModelLimiter(() => now);
    const endpoint = groqEndpoint(server.url("/groq"));
    const composer = chainComposer([endpoint], {
      judgeEndpoints: [endpoint],
      limiter,
      maxWaitMs: 70000,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    })!;
    const context = withAliases();
    const raw = await composer.judge!(context, goodDraft(context), newCallMeta());
    assert.equal(raw.grounding.score, 4);
    assert.equal(groq.requests.length, 2);
    assert.ok(slept.length >= 1 && slept[0]! >= 2000);

    // daily cap: waiting cannot help, so it refuses immediately even with a long allowance
    const capped = new ModelLimiter(() => now);
    capped.reserve("groq:qwen/qwen3.8-27b", 179000);
    slept.length = 0;
    const strict = chainComposer([endpoint], {
      judgeEndpoints: [endpoint],
      limiter: capped,
      maxWaitMs: 70000,
      sleep: async (ms) => void slept.push(ms),
    })!;
    const meta = newCallMeta();
    await assert.rejects(strict.judge!(context, goodDraft(context), meta), /MODEL_DAILY_CAP/);
    assert.deepEqual(slept, []);
    assert.equal(groq.requests.length, 2);
  } finally {
    await server.close();
  }
});
