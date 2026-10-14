import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptanceChecks,
  compose,
  type GenerationContext,
  type PacketV2,
} from "../lib/chapter11/engine";
import { chainComposer, ModelLimiter } from "../lib/chapter11/provider";
import {
  primedComposer,
  runInvestigation,
  toolAuditRows,
  type InvestigationBackend,
} from "../lib/chapter11/investigator";
import { createNodeRunner, type NodeTrace } from "../lib/chapter11/graph";
import { academicContext, attendanceContext, fakeBackend, groqEndpoint } from "./agent-fixtures";
import {
  draftReply,
  hasTools,
  route,
  startMockOpenAI,
  toolCallReply,
  userPayload,
  type MockReply,
} from "./mock-openai-server";

type Call = { name: string; args: Record<string, unknown> };
/** A scripted model: each tool turn asks for the next batch (built from the
 * case alias it was shown), then says ready; the final call drafts from the
 * payload it receives. */
function scripted(turns: Array<(alias: string) => Call[]>, finalOverride?: (body: unknown) => MockReply) {
  let turn = 0,
    alias = "";
  return (body: unknown): MockReply => {
    if (hasTools(body)) {
      if (!alias) alias = userPayload(body).case as string;
      const batch = turns[turn++]?.(alias) ?? [];
      return batch.length ? toolCallReply(batch) : { content: "ready" };
    }
    return finalOverride ? finalOverride(body) : draftReply(userPayload(body));
  };
}
async function withModel<T>(
  reply: (body: unknown) => MockReply,
  run: (ctx: { endpoint: ReturnType<typeof groqEndpoint>; requests: Array<{ body: unknown; raw: string }> }) => Promise<T>,
) {
  const mock = route(reply);
  const server = await startMockOpenAI({ "/m": mock });
  try {
    return await run({ endpoint: groqEndpoint(server.url("/m")), requests: mock.requests });
  } finally {
    await server.close();
  }
}
const investigate = (
  context: GenerationContext,
  endpoint: ReturnType<typeof groqEndpoint>,
  backend: InvestigationBackend,
) =>
  runInvestigation({
    context,
    endpoints: [endpoint],
    backend,
    studentId: context.evidence.academic.studentId,
    capturedAt: new Date().toISOString(),
    options: { limiter: new ModelLimiter(), maxWaitMs: 0 },
  });

test("the investigator picks tools, appends results to the snapshot, and the draft cites them", async () => {
  const context = attendanceContext();
  const { backend, hits } = fakeBackend();
  await withModel(
    scripted([
      (c) => [
        { name: "get_attendance_breakdown", args: { case: c, by: "course" } },
        { name: "get_lms_timeline", args: { case: c, weeks: 3 } },
      ],
    ]),
    async ({ endpoint, requests }) => {
      const outcome = await investigate(context, endpoint, backend);
      assert.equal(outcome.summary.mode, "tools");
      assert.deepEqual(hits, ["attendance:course", "lms:3"]);
      assert.deepEqual(
        outcome.summary.toolCalls.map((c) => [c.tool, c.status]),
        [["get_attendance_breakdown", "ok"], ["get_lms_timeline", "ok"]],
      );
      assert.equal(outcome.summary.turns, 2);
      // results live in the snapshot under their own evidence paths
      const tools = (outcome.context.evidence as unknown as { tools: { studentId: string; values: Record<string, number> } }).tools;
      assert.equal(tools.studentId, context.evidence.academic.studentId);
      assert.equal(tools.values["attendancePct@course:21CS501"], 50);
      assert.equal(tools.values["sessionsHeld@course:21CS501"], 10);
      assert.equal(tools.values["lessonsOpened@weeksago:1"], 3);
      assert.ok(Object.values(outcome.context.aliases!.evidence).includes("evidence.tools.values.attendancePct@course:21CS501"));
      // the original aliases are untouched; the augmented context owns the new ones
      assert.ok(!Object.values(context.aliases?.evidence ?? {}).some((p) => p.includes("tools")));
      // the final call: strict schema, no tools, rows carry only aliases and numbers
      const final = requests.at(-1)!;
      assert.ok(!hasTools(final.body));
      assert.ok(!final.raw.includes("21CS50"), "real course codes never leave");
      const row = userPayload(final.body).evidence.find((e) => e.source === "tools" && e.metric === "attendancePct" && e.value === 50);
      assert.match(row!.course!, /^course-\d$/);

      // compose with the loop's final draft as the first candidate
      const trace: NodeTrace = {};
      const composed = await compose(
        outcome.context,
        primedComposer(chainComposer([endpoint], { limiter: new ModelLimiter() })!, outcome),
        createNodeRunner(trace),
      );
      assert.equal(composed.validation.valid, true, JSON.stringify(composed.validation.failures));
      assert.equal(composed.mode, "model");
      const packet = composed.packet as PacketV2;
      const cited = packet.rationale.flatMap((r) => r.citations);
      assert.ok(cited.some((p) => p.startsWith("evidence.tools.values.")), "a tool result is cited");
      assert.ok(JSON.stringify(packet).includes("21CS501"), "restored to the real course code for the mentor");
      const agent = composed.validation.provenance.agent!;
      assert.equal(agent.mode, "tools");
      assert.equal(agent.toolCalls.length, 2);
      assert.ok(!("egress" in agent));
      assert.equal(composed.validation.provenance.egress.length, 3, "each loop request is in the egress audit");
      assert.equal(composed.validation.modelAttempts.length, 1, "the loop's final call is the first compose attempt");
      assert.equal(requests.length, 3);
      // audit rows: tool, aliased args, result hash and size
      const rows = toolAuditRows(outcome.summary);
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.event, "agent.tool_call");
      assert.ok((rows[0]!.output as { resultHash: string }).resultHash.length === 64);
    },
  );
});

test("tool scope: another student's alias is refused and audited, and reaches no data", async () => {
  const context = attendanceContext();
  const { backend, hits } = fakeBackend();
  await withModel(
    scripted([
      () => [
        { name: "get_attendance_breakdown", args: { case: "case-0000", by: "course" } },
        { name: "get_lms_timeline", args: { case: "01FE24BCI047", weeks: 2 } },
        { name: "get_policy", args: { case: "student-007" } },
      ],
    ]),
    async ({ endpoint }) => {
      const outcome = await investigate(context, endpoint, backend);
      assert.deepEqual(hits, [], "the backend was never reached");
      assert.deepEqual(
        outcome.summary.toolCalls.map((c) => [c.status, c.code]),
        [["refused", "OUT_OF_SCOPE"], ["refused", "OUT_OF_SCOPE"], ["refused", "OUT_OF_SCOPE"]],
      );
      assert.equal((outcome.context.evidence as unknown as { tools?: unknown }).tools, undefined);
      const rows = toolAuditRows(outcome.summary);
      assert.ok(rows.every((r) => r.event === "agent.tool_refused"));
    },
  );
});

test("a citation to a tool result validates; a fabricated tool path is rejected", async () => {
  const context = attendanceContext();
  const { backend } = fakeBackend();
  await withModel(
    scripted([(c) => [{ name: "get_attendance_breakdown", args: { case: c, by: "course" } }]]),
    async ({ endpoint }) => {
      const outcome = await investigate(context, endpoint, backend);
      const c = outcome.context;
      const check = (candidate: unknown, aliases = c.aliases) =>
        acceptanceChecks(candidate, c.evidence, c.risk, c.domain, undefined, {
          aliases,
          policy: c.policy,
          version: 2,
          specialist: (c.baseline as PacketV2).specialist,
        });
      const draft = outcome.primed as PacketV2;
      assert.deepEqual(check(draft).failures, []);

      // restored form (no aliases): the real tool path is accepted
      const lowRef = Object.entries(c.aliases!.evidence).find(([, p]) => p.endsWith("attendancePct@course:21CS501"))![0];
      const mk = (citation: string, text = "The weakest course sits at 50 percent attendance.") => ({
        ...draft,
        rationale: [draft.rationale[0]!, { text, citations: [citation] }],
      });
      assert.deepEqual(check(mk(lowRef)).failures, []);
      assert.deepEqual(
        check(mk("evidence.tools.values.attendancePct@course:21CS501"), undefined).failures.filter((f) => f.code === "UNSUPPORTED_CITATION"),
        [],
      );
      // fabricated: a path no tool produced, and an unknown alias
      for (const fake of ["evidence.tools.values.attendancePct@course:21CS999", "evidence.tools.values.attendancePct@course:21CS501x", "ev-99"])
        assert.ok(
          check(mk(fake)).failures.some((f) => f.code === "UNSUPPORTED_CITATION"),
          fake,
        );
      // a real tool path cannot launder a number it does not contain
      assert.ok(check(mk(lowRef, "The weakest course sits at 31 percent attendance.")).failures.some((f) => f.code === "UNSUPPORTED_NUMBER"));
      // evidence from another student fails the privacy check
      const foreign = { ...c.evidence, tools: { ...(c.evidence as unknown as { tools: object }).tools, studentId: "00000000-0000-4000-8000-000000000000" } };
      assert.equal(
        acceptanceChecks(draft, foreign as never, c.risk, c.domain, undefined, { aliases: c.aliases, policy: c.policy, version: 2, specialist: "attendance" }).checks.privacy_scope_enforced,
        false,
      );
    },
  );
});

test("egress guard blocks a name planted in a tool result; the run falls back to the standard evidence", async () => {
  const context = attendanceContext();
  const { backend } = fakeBackend({
    // a corrupted prior-intervention record carrying a surname as an action code
    async similar() {
      return [{ id: "r1", text: "x", tags: ["attendance"], similarity: 0.4, embeddingModel: "m", actionCodes: ["raman"] }];
    },
  });
  await withModel(
    scripted([(c) => [{ name: "get_similar_prior_interventions", args: { case: c, k: 2 } }]]),
    async ({ endpoint, requests }) => {
      const outcome = await investigate(context, endpoint, backend);
      assert.equal(outcome.summary.mode, "standard-evidence");
      assert.equal(outcome.summary.fallbackReason, "EGRESS_BLOCKED: roster_name");
      assert.equal(requests.length, 1, "only the harmless first turn was sent");
      assert.equal(outcome.summary.egress.at(-1)!.outcome, "blocked");
      assert.equal(outcome.primed, undefined);
      assert.ok(!JSON.stringify(outcome.summary).toLowerCase().includes("raman"));
      assert.deepEqual(outcome.context.aliases, context.aliases ?? outcome.context.aliases);
      assert.equal(Object.values(outcome.context.aliases!.evidence).some((p) => p.includes("tools")), false);
      assert.equal(outcome.context.references.length, 0, "the poisoned reference is not carried forward");
    },
  );
});

test("fallback when the provider has no tool support: today's behaviour, labelled", async () => {
  const context = attendanceContext();
  const { backend, hits } = fakeBackend();
  await withModel(
    (body) => (hasTools(body) ? { status: 400, body: { error: { message: "unsupported" } } } : draftReply(userPayload(body))),
    async ({ endpoint, requests }) => {
      const outcome = await investigate(context, endpoint, backend);
      assert.equal(outcome.summary.mode, "standard-evidence");
      assert.match(outcome.summary.fallbackReason!, /^TOOLS_UNSUPPORTED/);
      assert.deepEqual(hits, []);
      // compose continues exactly as before: one ordinary drafting call
      const composed = await compose(
        outcome.context,
        chainComposer([endpoint], { limiter: new ModelLimiter() }),
      );
      assert.equal(composed.validation.valid, true, JSON.stringify(composed.validation.failures));
      assert.equal(composed.validation.provenance.agent!.mode, "standard-evidence");
      assert.match(composed.validation.provenance.agent!.fallbackReason!, /TOOLS_UNSUPPORTED/);
      assert.equal(requests.length, 2, "one refused tool request, one drafting call");
      assert.equal(composed.validation.provenance.agent!.fallbacks[0]!.reason, "MODEL_HTTP_400");
    },
  );
});

test("the wellbeing pack and a missing endpoint skip the investigation, labelled", async () => {
  const wellbeing = attendanceContext();
  const { formatSkillV2 } = await import("../lib/chapter11/engine");
  const ctx: GenerationContext = { ...wellbeing, domain: "wellbeing-referral", baseline: formatSkillV2(wellbeing.risk, "wellbeing-referral", wellbeing.evidence) };
  const { backend } = fakeBackend();
  const skipped = await runInvestigation({ context: ctx, endpoints: [groqEndpoint("http://127.0.0.1:1/x")], backend, studentId: "s", capturedAt: new Date().toISOString() });
  assert.equal(skipped.summary.mode, "standard-evidence");
  assert.match(skipped.summary.skippedReason!, /triggering signals/);
  const none = await runInvestigation({ context: wellbeing, endpoints: [], backend, studentId: "s", capturedAt: new Date().toISOString() });
  assert.match(none.summary.skippedReason!, /no model endpoint/);
});

test("every investigator tool resolves to numbers only, with refs, inside the allowlist", async () => {
  const { backend } = fakeBackend();
  const all = (c: string): Call[] => [
    { name: "get_assessment_breakdown", args: { case: c } },
    { name: "get_internship_status", args: { case: c } },
    { name: "get_placement_activity", args: { case: c } },
    { name: "get_policy", args: { case: c } },
  ];
  const ctx = academicContext();
  assert.equal((ctx.baseline as PacketV2).specialist, "academic");
  await withModel(scripted([all]), async ({ endpoint, requests }) => {
    const outcome = await investigate(ctx, endpoint, backend);
    assert.deepEqual(outcome.summary.toolCalls.map((c) => c.status), ["ok", "ok", "ok", "ok"]);
    const toolMessage = (requests[1]!.body as { messages: Array<{ role: string; content: string }> }).messages.filter((m) => m.role === "tool");
    assert.match(toolMessage[0]!.content, /"component":"quiz","pct":\{"v":64\.5,"ref":"ev-\d+"\}/);
    const values = (outcome.context.evidence as unknown as { tools: { values: Record<string, number> } }).tools.values;
    assert.equal(values["markPct@component:quiz"], 64.5);
    assert.equal(values["missedMilestones"], 0);
  });
});
