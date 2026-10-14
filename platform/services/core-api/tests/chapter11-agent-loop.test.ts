import assert from "node:assert/strict";
import test from "node:test";
import {
  runAgentLoop,
  ToolRefused,
  type AgentTool,
} from "../lib/chapter11/agent-loop";
import type { ChatRequest } from "../lib/chapter11/provider";
import { ModelLimiter } from "../lib/chapter11/provider";
import { groqEndpoint, ROSTER } from "./agent-fixtures";
import {
  hasTools,
  route,
  schemaName,
  startMockOpenAI,
  toolCallReply,
  toolsUnsupported,
} from "./mock-openai-server";

type Msg = { content?: string; tool_call_id?: string; tool_calls?: Array<{ id: string }> };
const obj = { type: "object", properties: {}, additionalProperties: false };
const tool = (name: string, run: AgentTool["run"]): AgentTool => ({
  name,
  description: name,
  parameters: obj,
  run,
});
const finalRequest = (): ChatRequest => ({
  fields: ["messages"],
  body: {
    temperature: 0,
    max_tokens: 100,
    // a stray `tools` here must be stripped by the loop
    tools: [{ type: "function", function: { name: "ping" } }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "final_answer",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
      },
    },
    messages: [{ role: "user", content: "{}" }],
  },
});
async function withModel(
  replies: Parameters<typeof route>,
  run: (ctx: { base: string; mock: ReturnType<typeof route> }) => Promise<void>,
) {
  const mock = route(...replies);
  const server = await startMockOpenAI({ "/m": mock });
  try {
    await run({ base: server.url("/m"), mock });
  } finally {
    await server.close();
  }
}
const config = (base: string, tools: AgentTool[], roster = ROSTER) => ({
  endpoints: [groqEndpoint(base)],
  roster,
  system: "You are a test agent.",
  user: { payload: { case: "case-abcd" }, fields: ["case"] },
  tools,
  final: { build: finalRequest },
  options: { limiter: new ModelLimiter(), maxWaitMs: 0 },
});

test("loop budget: a 3rd tool turn and a 5th tool call are refused and audited", async () => {
  let executed = 0;
  const ping = tool("ping", () => {
    executed++;
    return { n: executed };
  });
  await withModel(
    // a misbehaving model that asks for tools on every request, even the final one
    [() => toolCallReply([{ name: "ping", args: {} }, { name: "ping", args: {} }, { name: "ping", args: {} }])],
    async ({ base, mock }) => {
      const result = await runAgentLoop(config(base, [ping]));
      assert.equal(executed, 4, "only four calls run");
      assert.equal(mock.requests.length, 3, "two tool turns plus one final call, never a 3rd tool turn");
      assert.equal(result.turns, 2);
      assert.deepEqual(
        result.calls.map((c) => c.code ?? c.status),
        ["ok", "ok", "ok", "ok", "BUDGET_EXCEEDED", "BUDGET_EXCEEDED", "TURN_LIMIT", "TURN_LIMIT", "TURN_LIMIT"],
      );
      assert.ok(result.calls.slice(0, 4).every((c) => c.resultHash && c.resultBytes));
      assert.ok(result.calls.slice(4).every((c) => c.status === "refused" && !c.resultHash));
      assert.equal(result.status, "fallback");
      assert.match(result.fallbackReason!, /MODEL_REQUESTED_EXTRA_TURN/);
      // tool turns carry tools and no response_format; the final call the reverse
      const [t1, t2, last] = mock.requests.map((r) => r.body as Record<string, unknown>);
      for (const turn of [t1, t2]) {
        assert.ok(hasTools(turn));
        assert.equal(turn!.response_format, undefined);
      }
      assert.ok(!hasTools(last));
      assert.equal(schemaName(last), "final_answer");
    },
  );
});

test("loop: tool turns, canonical call ids, strict final call, per-call audit", async () => {
  const ping = tool("ping", () => ({ rows: [{ course: "course-1", pct: 58.3 }] }));
  await withModel(
    [toolCallReply([{ name: "ping", args: { a: 1 } }]), { content: "ready" }, { content: '{"ok":true}' }],
    async ({ base, mock }) => {
      const result = await runAgentLoop(config(base, [ping]));
      assert.equal(result.status, "completed");
      assert.deepEqual(result.output, { ok: true });
      assert.equal(result.calls.length, 1);
      assert.deepEqual(result.calls[0]!.args, { a: 1 });
      assert.equal(result.egress.length, 3, "every remote payload is sealed and audited");
      assert.ok(result.egress.every((e) => e.outcome === "sent" && e.payloadHash.length === 64));
      assert.equal(result.tokens, 450);
      // the provider's own id never goes back out; ids are canonical
      assert.ok(mock.requests.every((r) => !r.raw.includes("9f3a2b1")));
      const second = mock.requests[1]!.body as { messages: Msg[] };
      assert.equal(second.messages.at(-2)!.tool_calls![0]!.id, "call_1");
      assert.equal(second.messages.at(-1)!.tool_call_id, "call_1");
    },
  );
});

test("loop: a provider without tool support falls back, labelled", async () => {
  await withModel([toolsUnsupported], async ({ base, mock }) => {
    const result = await runAgentLoop(config(base, [tool("ping", () => ({}))]));
    assert.equal(result.status, "fallback");
    assert.match(result.fallbackReason!, /^TOOLS_UNSUPPORTED: groq MODEL_HTTP_400/);
    assert.equal(mock.requests.length, 1);
    assert.equal(result.calls.length, 0);
    assert.equal(result.fallbacks[0]!.provider, "groq");
  });
});

test("loop: egress guard blocks a name planted in a tool result before the next send", async () => {
  // 'raman' is a word the allowlist cannot tell from an enum value; the roster guard can
  await withModel(
    [toolCallReply([{ name: "lookup", args: {} }]), { content: '{"ok":true}' }],
    async ({ base, mock }) => {
      const result = await runAgentLoop(
        config(base, [tool("lookup", () => ({ label: "raman" }))]),
      );
      assert.equal(result.status, "fallback");
      assert.equal(result.fallbackReason, "EGRESS_BLOCKED: roster_name");
      assert.equal(mock.requests.length, 1, "the poisoned payload never left");
      const blocked = result.egress.at(-1)!;
      assert.equal(blocked.outcome, "blocked");
      assert.equal(blocked.category, "roster_name");
      assert.ok(!JSON.stringify(result).toLowerCase().includes("raman"), "the value is never recorded");
      assert.equal(result.calls[0]!.status, "ok");
    },
  );
});

test("loop: free text in a tool result is rejected by the allowlist, not sent", async () => {
  await withModel(
    [toolCallReply([{ name: "lookup", args: {} }]), { content: "ready" }, { content: '{"ok":true}' }],
    async ({ base, mock }) => {
      const result = await runAgentLoop(
        config(base, [tool("lookup", () => ({ note: "Priya Raman likes maths" }))]),
      );
      assert.equal(result.status, "completed");
      assert.equal(result.calls[0]!.code, "RESULT_NOT_ALLOWLISTED");
      assert.ok(mock.requests.every((r) => !r.raw.includes("Priya")));
    },
  );
});

test("loop: a tool refusal and an unknown tool are audited and reported to the model as codes", async () => {
  const guarded = tool("guarded", () => {
    throw new ToolRefused("OUT_OF_SCOPE");
  });
  await withModel(
    [
      toolCallReply([{ name: "guarded", args: {} }, { name: "nope", args: {} }]),
      { content: "ready" },
      { content: '{"ok":true}' },
    ],
    async ({ base, mock }) => {
      const result = await runAgentLoop(config(base, [guarded]));
      assert.deepEqual(
        result.calls.map((c) => [c.tool, c.status, c.code]),
        [
          ["guarded", "refused", "OUT_OF_SCOPE"],
          ["nope", "refused", "UNKNOWN_TOOL"],
        ],
      );
      const second = mock.requests[1]!.body as { messages: Msg[] };
      assert.equal(second.messages.at(-2)!.content, '{"error":"OUT_OF_SCOPE"}');
    },
  );
});
