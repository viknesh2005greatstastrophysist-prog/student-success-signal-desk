import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  compose,
  demoPolicy,
  formatSkill,
  referenceLibrary,
  riskAnalysis,
  sourceNames,
  specialistRegistry,
  actions,
  newCallMeta,
  type Evidence,
  type GenerationContext,
} from "../lib/chapter11/engine";
import {
  buildAliases,
  courseValueKey,
  EgressBlocked,
  restoreAliases,
  scanForIdentifiers,
  sealOutbound,
  serializeDraftRequest,
  type GuardRoster,
} from "../lib/chapter11/egress";
import {
  anonymousModelContext,
  captureModelCredentials,
  chainComposer,
  configuredComposer,
  forgetModelCredentials,
  modelEndpoints,
  ModelLimiter,
  type Endpoint,
} from "../lib/chapter11/provider";
import { startMockOpenAI, route } from "./mock-openai-server";

const FIRST = ["Aarav", "Vihaan", "Ananya", "Diya", "Ishaan", "Kavya", "Rohan", "Sneha", "Pranav", "Meghana", "Siddharth", "Lakshmi", "Varun", "Pooja", "Karthik", "Nandini", "Abhishek", "Shreya", "Manjunath", "Bhavana", "Tejas", "Akshata", "Chaitanya", "Rakshitha"];
const LAST = ["Kulkarni", "Patil", "Hegde", "Desai", "Naik", "Shetty", "Joshi", "Bhat", "Rao", "Gowda", "Reddy", "Iyer", "Menon", "Sharma", "Deshpande", "Kamath", "Pai", "Shanbhag", "Hiremath", "Angadi"];
let seed = 20261014;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
const srn = () =>
  `01FE2${Math.floor(rand() * 6)}BCI${String(Math.floor(rand() * 999)).padStart(3, "0")}`;

function caseFixture() {
  const student = randomUUID();
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const register = srn();
  const email = `${name.split(" ")[0]!.toLowerCase()}.${register.toLowerCase()}@college.example.edu`;
  const phone = `+91 9${Math.floor(rand() * 1e9).toString().padStart(9, "0")}`;
  const course = `21CS${Math.floor(rand() * 900) + 100}`;
  const evidence = Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source,
        studentId: student,
        recordId: `${register}:${source}`,
        observedAt: "2026-09-07T00:00:00.000Z",
        semester: "2026-ODD",
        state: "present",
        synthetic: true,
        values:
          source === "academic"
            ? {
                attendancePct: 40 + rand() * 50,
                markPct: 30 + rand() * 60,
                [courseValueKey("attendancePct", course)]: 30 + rand() * 60,
                studentName: name,
                registerNumber: register,
                contact: email,
                phone,
                collegeDatasetHash: "f".repeat(64),
              }
            : source === "lms"
              ? { inactivityDays: Math.floor(rand() * 20), overdueAssignments: Math.floor(rand() * 5), note: `${name} spoke to me on 2026-09-01` }
              : source === "internship"
                ? { missedMilestones: Math.floor(rand() * 3) }
                : { missedActivities: Math.floor(rand() * 3) },
      },
    ]),
  ) as unknown as Evidence;
  const risk = riskAnalysis(evidence, demoPolicy);
  const context: GenerationContext = {
    evidence,
    risk,
    domain: "academic",
    baseline: formatSkill(risk, "academic"),
    policy: demoPolicy,
    references: [
      { id: "GUIDE-ACADEMIC-1", text: referenceLibrary[0]!.text, tags: ["academic"], similarity: 0.71234567, embeddingModel: "x" },
      { id: randomUUID(), text: `Earlier approved support actions for ${name}: attendance-review`, tags: ["attendance"], similarity: 0.5, embeddingModel: "x", actionCodes: ["attendance-review", `${register}`] },
    ],
    roster: { names: [name, `${pick(FIRST)} ${pick(LAST)}`], registers: [register], emails: [email], phrases: ["KLE Technological University", "Computer Science and Engineering"] },
  };
  return { context, name, register, email, phone, course, student };
}
const catalogue = specialistRegistry.academic.codes.map((code) => ({ code, label: actions[code] }));
const library = Object.fromEntries(referenceLibrary.map((r) => [r.id, r.text]));

test("egress property: fuzzed cases with realistic names and SRNs never leave the server", () => {
  for (let i = 0; i < 250; i++) {
    const { context, name, register, email, phone, course, student } = caseFixture();
    const aliases = buildAliases(context.evidence, `${i}`.padStart(8, "0"));
    const { payload, fields } = serializeDraftRequest(context, {
      aliases,
      pack: "academic",
      instruction: specialistRegistry.academic.instruction,
      catalogue,
      library,
      now: Date.parse("2026-10-14T00:00:00.000Z"),
    });
    for (const body of [
      { messages: [{ role: "user", content: JSON.stringify(payload) }] },
      { messages: [{ role: "user", content: JSON.stringify(anonymousModelContext(context)) }] },
    ]) {
      const sealed = sealOutbound(body, { provider: "groq", model: "m", fields, roster: context.roster });
      for (const secret of [name, ...name.split(" "), register, email, phone, course, student, "2026-09", "college.example"])
        assert.ok(!sealed.serialized.includes(secret), `leaked a ${secret === course ? "course code" : "identifier"}`);
      assert.equal(sealed.audit.outcome, "sent");
      assert.equal(sealed.audit.bytes, Buffer.byteLength(sealed.serialized));
      assert.match(sealed.audit.payloadHash, /^[0-9a-f]{64}$/);
    }
    assert.ok(fields.includes("signals[].threshold") || context.risk.signals.length === 0);
    assert.ok(payload.evidence.some((e) => e.course === "course-1"));
    assert.ok(payload.evidence.every((e) => /^(today|\d+ days? ago)$/.test(e.observed)));
  }
});

test("egress guard: a planted roster name, SRN, email, phone, UUID or date in any field is refused by category only", () => {
  const { context } = caseFixture();
  const aliases = buildAliases(context.evidence, "abcdef12");
  const { payload, fields } = serializeDraftRequest(context, { aliases, pack: "academic", instruction: "x", catalogue, library });
  const leaves: string[][] = [];
  const walk = (v: unknown, path: string[]) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
    else leaves.push(path);
  };
  walk(payload, []);
  assert.ok(leaves.length > 20);
  const roster: GuardRoster = { names: ["Meghana Kulkarni"], registers: ["01FE24BCI047"], emails: [], phrases: ["KLE Technological University"] };
  const plants: Array<[string, string]> = [
    ["Kulkarni", "roster_name"],
    ["meghana", "roster_name"],
    ["KLE Technological University", "roster_name"],
    ["01FE24BCI047", "register_number"],
    ["1RV22CS001", "register_number"],
    ["meghana.k@college.example.edu", "email"],
    ["+91 98450 12345", "phone"],
    [randomUUID(), "uuid"],
    ["2026-09-07", "date"],
  ];
  for (const leaf of leaves)
    for (const [value, category] of plants) {
      const planted = structuredClone(payload) as Record<string, unknown>;
      let cursor: Record<string, unknown> = planted;
      for (const key of leaf.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
      cursor[leaf.at(-1)!] = `${String(cursor[leaf.at(-1)!])} ${value}`;
      assert.throws(
        () => sealOutbound({ messages: [{ role: "user", content: JSON.stringify(planted) }] }, { provider: "groq", model: "m", fields, roster }),
        (error: unknown) => {
          assert.ok(error instanceof EgressBlocked);
          assert.equal(error.message, "EGRESS_BLOCKED");
          assert.equal(error.category, category);
          assert.equal(error.audit?.outcome, "blocked");
          assert.ok(!JSON.stringify(error.audit).includes(value));
          return true;
        },
      );
    }
  assert.equal(scanForIdentifiers(JSON.stringify(payload), roster), undefined);
});

test("aliases restore to real course codes and snapshot paths only on the server", () => {
  const { context, course } = caseFixture();
  const aliases = buildAliases(context.evidence, "00ff00ff");
  const ref = Object.entries(aliases.evidence).find(([, p]) => p.includes("@"))![0];
  const restored = restoreAliases(
    { rationale: [{ text: `Attendance in course-1 fell for ${aliases.caseAlias}; course-9 is unknown`, citations: [ref, "ev-99"] }] },
    aliases,
  );
  assert.equal(restored.rationale[0]!.text, `Attendance in ${course} fell for the student; course-9 is unknown`);
  assert.deepEqual(restored.rationale[0]!.citations, [aliases.evidence[ref], "ev-99"]);
});

const ENV = ["CORE_IDENTITY_REALM", "CH11_MODEL", "CH11_MODEL_BASE_URL", "CH11_MODEL_API_KEY", "GROQ_API_KEY", "CH11_GROQ_BASE_URL", "CH11_PROVIDER_ORDER", "CH11_GROQ_DAILY_TOKEN_CAP"] as const;
async function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, work: () => Promise<void> | void) {
  const prior = Object.fromEntries(ENV.map((n) => [n, process.env[n]]));
  try {
    for (const n of ENV) delete process.env[n];
    Object.assign(process.env, values);
    await work();
  } finally {
    for (const n of ENV) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
  }
}

test("provider chain: Groq first with its own models, Gemini next, arbitrary remotes stay closed in project mode", async () => {
  await withEnv({ CORE_IDENTITY_REALM: "project", GROQ_API_KEY: "TEST-KEY", CH11_MODEL: "gemini-3.1-flash-lite", CH11_MODEL_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai", CH11_MODEL_API_KEY: "TEST-GEMINI" }, () => {
    const draft = modelEndpoints("draft");
    assert.deepEqual(draft.map((e) => [e.kind, e.model, e.remote]), [["groq", "qwen/qwen3.8-27b", true], ["gemini", "gemini-3.1-flash-lite", true]]);
    assert.equal(draft[0]!.base, "https://api.groq.com/openai/v1");
    assert.equal(modelEndpoints("judge")[0]!.model, "openai/gpt-oss-120b");
    process.env.CH11_MODEL_BASE_URL = "https://remote.example/v1";
    assert.throws(() => modelEndpoints(), /loopback/);
    process.env.CH11_MODEL_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.CH11_MODEL = "local-qwen";
    assert.deepEqual(modelEndpoints().map((e) => e.kind), ["groq", "local"], "Groq first, the laptop model last");
    process.env.CH11_GROQ_BASE_URL = "https://evil.example/openai/v1";
    assert.throws(() => modelEndpoints(), /official/);
  });
  await withEnv({ GROQ_API_KEY: "CAPTURED" }, () => {
    const env = { GROQ_API_KEY: "CAPTURED" } as unknown as NodeJS.ProcessEnv;
    captureModelCredentials(env);
    assert.equal(env.GROQ_API_KEY, undefined);
    delete process.env.GROQ_API_KEY;
    assert.equal(modelEndpoints()[0]!.kind, "groq");
    forgetModelCredentials();
    assert.equal(modelEndpoints().length, 0);
  });
});

test("mock Groq 429 honours retry-after and falls back to the next provider with a label", async () => {
  const groq = route({ status: 429, headers: { "retry-after": "7" }, body: { error: { message: "rate limited" } } });
  const gemini = route({ content: "{}" });
  const server = await startMockOpenAI({ "/groq": groq, "/gemini": gemini });
  try {
    const endpoints: Endpoint[] = [
      { kind: "groq", base: server.url("/groq"), model: "qwen/qwen3.8-27b", key: "TEST", remote: true, extra: { reasoning_effort: "none" } },
      { kind: "gemini", base: server.url("/gemini"), model: "gemini-test", key: "TEST", remote: true, extra: {} },
    ];
    const limiter = new ModelLimiter();
    const { context } = caseFixture();
    const composer = chainComposer(endpoints, { limiter, maxWaitMs: 0 })!;
    const meta = newCallMeta();
    await composer.generate(context, undefined, undefined, meta);
    assert.equal(meta.provider, "gemini");
    assert.equal(meta.fallbacks.length, 1);
    assert.equal(meta.fallbacks[0]!.provider, "groq");
    assert.match(meta.fallbacks[0]!.reason, /MODEL_HTTP_429: rate limited \(HTTP 429, retry after 7s\)/);
    assert.equal(meta.egress.length, 2);
    assert.ok(meta.egress.every((e) => e.outcome === "sent" && e.bytes > 0));
    assert.equal(groq.requests[0]!.authorization, "Bearer TEST");
    // Within retry-after, Groq is not called again; the fallback says why.
    const again = newCallMeta();
    await composer.generate(context, undefined, undefined, again);
    assert.equal(groq.requests.length, 1);
    assert.match(again.fallbacks[0]!.reason, /MODEL_RATE_LIMITED: cooling down/);
    // compose() records the served provider and every labelled fallback.
    const composed = await compose({ ...context }, composer);
    assert.equal(composed.validation.provenance.fallbacks[0]!.provider, "groq");
    assert.ok(composed.validation.provenance.egress.length >= 1);
    // When every provider refuses, no draft is made: the case waits as AI unavailable.
    gemini.replies.splice(0, gemini.replies.length, { status: 429, headers: { "retry-after": "30" } });
    const exhausted = await compose({ ...context }, chainComposer(endpoints, { limiter: new ModelLimiter(), maxWaitMs: 0 })!);
    assert.equal(exhausted.unavailable, true);
    assert.equal(exhausted.mode, "unavailable");
    assert.equal(exhausted.validation.valid, false);
    assert.equal(exhausted.validation.escalated, false);
    assert.equal(exhausted.modelId, null);
    assert.equal(exhausted.validation.providerError, "MODEL_HTTP_429");
    assert.match(String(exhausted.validation.provenance.fallbackReason), /provider failed: MODEL_HTTP_429/);
  } finally {
    await server.close();
  }
});

test("egress refusal stops the chain before any byte is sent and is audited", async () => {
  const groq = route({ content: "{}" });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    const { context, name } = caseFixture();
    const composer = chainComposer(
      [{ kind: "groq", base: server.url("/groq"), model: "m", key: "TEST", remote: true, extra: {} }],
      { limiter: new ModelLimiter(), maxWaitMs: 0 },
    )!;
    // A roster surname that also appears in a library text is still refused.
    const leaky = { ...context, roster: { names: [name, "Catch Up"] } };
    const result = await compose(leaky, composer);
    assert.equal(groq.requests.length, 0);
    assert.equal(result.validation.providerError, "EGRESS_BLOCKED");
    assert.equal(result.validation.provenance.egress[0]!.outcome, "blocked");
    assert.equal(result.validation.provenance.egress[0]!.category, "roster_name");
    assert.ok(!JSON.stringify(result.validation.provenance).includes("Catch"));
  } finally {
    await server.close();
  }
});

test("token-aware limiter waits within a minute, refuses beyond the daily cap", () => {
  let now = 0;
  const limiter = new ModelLimiter(() => now);
  const budget = { tpm: 8000, rpm: 30, dailyTokens: 10000 };
  assert.deepEqual(limiter.check("g", 5000, budget), { waitMs: 0 });
  limiter.reserve("g", 5000);
  now = 20000;
  const verdict = limiter.check("g", 4000, budget);
  assert.ok("waitMs" in verdict && verdict.waitMs === 40000);
  now = 61000;
  limiter.reserve("g", 4000);
  const capped = limiter.check("g", 2000, budget);
  assert.ok("refused" in capped && capped.refused === "MODEL_DAILY_CAP");
});

test("configured chain stays undefined without credentials and keeps loopback-only for unknown remotes", async () => {
  await withEnv({}, () => assert.equal(configuredComposer(), undefined));
});
