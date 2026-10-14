import { createHash } from "node:crypto";
import {
  allowlistToolResult,
  EgressBlocked,
  fieldList,
  ToolResultRejected,
  type EgressAudit,
  type GuardRoster,
} from "./egress";
import {
  callChain,
  decodeModelContent,
  failureReason,
  type ChainOptions,
  type ChatRequest,
  type Endpoint,
} from "./provider";
import { newCallMeta, type CallMeta } from "./engine";

/**
 * One agent loop for the investigator (Brief 12) and the planner (Brief 13).
 *
 * Tool-calling turns send OpenAI-style `tools` and no `response_format` (Groq
 * cannot combine strict json_schema with tools). After the tool turns, exactly
 * one final call carries the strict schema and no tools. Every request goes
 * through `callChain`, so remote bodies are sealed by the egress guard and
 * audited; every tool call, executed or refused, becomes a `ToolCallRecord`.
 */
export type AgentBudget = { maxTurns: number; maxToolCalls: number };
export const DEFAULT_BUDGET: AgentBudget = { maxTurns: 2, maxToolCalls: 4 };
const MAX_RESULT_BYTES = 6000;

/** Thrown by a tool to refuse a call (scope, arguments); the loop audits it. */
export class ToolRefused extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

export type AgentTool = {
  name: string;
  description: string;
  /** JSON schema of the arguments, sent to the model */
  parameters: Record<string, unknown>;
  /** Receives the parsed (aliased) arguments; must validate them itself. */
  run(args: unknown): Promise<unknown> | unknown;
};

export type ToolCallRecord = {
  seq: number;
  turn: number;
  tool: string;
  /** the arguments exactly as the model sent them (aliases only), truncated */
  args: unknown;
  status: "ok" | "refused" | "error";
  /** why a call was refused or failed */
  code?: string;
  resultHash?: string;
  resultBytes?: number;
};

export type LoopMessage = Record<string, unknown>;
export type LoopState = {
  messages: LoopMessage[];
  calls: ToolCallRecord[];
};

export type AgentLoopConfig = {
  endpoints: Endpoint[];
  roster?: GuardRoster;
  system: string;
  /** the allowlisted brief for the first user message */
  user: { payload: unknown; fields: string[] };
  tools: AgentTool[];
  budget?: Partial<AgentBudget>;
  /** max_tokens for a tool-calling turn */
  turnMaxTokens?: number;
  final: {
    /** the complete final request body; `tools` are stripped by the loop */
    build(endpoint: Endpoint, state: LoopState): ChatRequest;
    decode?(content: string): unknown;
  };
  options?: ChainOptions;
};

export type AgentLoopResult = {
  status: "completed" | "fallback";
  output?: unknown;
  /** tool-calling turns (model calls that offered tools) */
  turns: number;
  modelCalls: number;
  calls: ToolCallRecord[];
  provider?: string;
  model?: string;
  fallbacks: CallMeta["fallbacks"];
  egress: EgressAudit[];
  tokens: number | null;
  latencyMs: number;
  fallbackReason?: string;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function truncatedArgs(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const text = JSON.stringify(parsed);
    return text.length > 300 ? { truncated: true } : parsed;
  } catch {
    return { unparseable: true };
  }
}

export function toolSpecs(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

const TOOLS_UNSUPPORTED = /^MODEL_HTTP_(400|404|422)\b/;

export async function runAgentLoop(
  config: AgentLoopConfig,
): Promise<AgentLoopResult> {
  const budget = { ...DEFAULT_BUDGET, ...config.budget };
  const byName = new Map(config.tools.map((t) => [t.name, t]));
  const started = performance.now();
  const messages: LoopMessage[] = [
    { role: "system", content: config.system },
    { role: "user", content: JSON.stringify(config.user.payload) },
  ];
  const calls: ToolCallRecord[] = [];
  const results: unknown[] = [];
  const fallbacks: CallMeta["fallbacks"] = [];
  const egress: EgressAudit[] = [];
  let tokens = 0,
    sawTokens = false,
    turns = 0,
    modelCalls = 0,
    attempted = 0,
    served: { provider?: string; model?: string } = {};
  const absorb = (meta: CallMeta) => {
    fallbacks.push(...meta.fallbacks);
    egress.push(...meta.egress);
    if (meta.usage?.total !== undefined) {
      tokens += meta.usage.total;
      sawTokens = true;
    }
    if (meta.provider) served = { provider: meta.provider, model: meta.model };
  };
  const finish = (
    status: "completed" | "fallback",
    extra: { output?: unknown; fallbackReason?: string } = {},
  ): AgentLoopResult => ({
    status,
    ...extra,
    turns,
    modelCalls,
    calls,
    ...served,
    fallbacks,
    egress,
    tokens: sawTokens ? tokens : null,
    latencyMs: Math.round(performance.now() - started),
  });
  const reasonFor = (error: unknown, toolPhase: boolean, meta: CallMeta) => {
    if (error instanceof EgressBlocked)
      return `EGRESS_BLOCKED: ${error.category}`;
    if (
      toolPhase &&
      meta.fallbacks.length > 0 &&
      meta.fallbacks.every((f) => TOOLS_UNSUPPORTED.test(f.reason))
    )
      return `TOOLS_UNSUPPORTED: ${meta.fallbacks.map((f) => `${f.provider} ${f.reason}`).join("; ")}`;
    return `provider failed: ${failureReason(error)}`;
  };

  try {
    // ---- tool-calling turns: tools offered, no response_format ----
    while (turns < budget.maxTurns) {
      const meta = newCallMeta();
      let response;
      try {
        modelCalls++;
        response = await callChain(
          config.endpoints,
          () => ({
            fields: fieldList({
              brief: config.user.payload,
              tools: config.tools.map((t) => t.name),
              calls: calls.map((c) => ({ tool: c.tool, args: c.args })),
              results,
            }),
            body: {
              temperature: 0,
              max_tokens: config.turnMaxTokens ?? 400,
              tools: toolSpecs(config.tools),
              tool_choice: "auto",
              messages,
            },
          }),
          config.roster,
          meta,
          config.options,
        );
      } catch (error) {
        absorb(meta);
        return finish("fallback", {
          fallbackReason: reasonFor(error, true, meta),
        });
      }
      absorb(meta);
      turns++;
      const requested = response.result.toolCalls ?? [];
      if (!requested.length) break; // the model needs no further look-ups
      const issued = requested.map((call, i) => ({
        ...call,
        id: `call_${calls.length + i + 1}`,
      }));
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: issued.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      });
      for (const call of issued) {
        const record: ToolCallRecord = {
          seq: calls.length + 1,
          turn: turns,
          tool: call.name.slice(0, 64),
          args: truncatedArgs(call.arguments),
          status: "refused",
        };
        calls.push(record);
        let content: string;
        if (attempted >= budget.maxToolCalls) {
          record.code = "BUDGET_EXCEEDED";
          content = JSON.stringify({ error: record.code });
        } else {
          attempted++;
          const tool = byName.get(call.name);
          if (!tool) {
            record.code = "UNKNOWN_TOOL";
            content = JSON.stringify({ error: record.code });
          } else {
            try {
              const parsed: unknown = JSON.parse(call.arguments || "{}");
              const value = allowlistToolResult(await tool.run(parsed));
              content = JSON.stringify(value);
              if (Buffer.byteLength(content) > MAX_RESULT_BYTES)
                throw new ToolRefused("RESULT_TOO_LARGE");
              record.status = "ok";
              record.resultHash = sha256(content);
              record.resultBytes = Buffer.byteLength(content);
              results.push(value);
            } catch (error) {
              if (error instanceof ToolRefused) {
                record.status = "refused";
                record.code = error.code;
              } else if (error instanceof ToolResultRejected) {
                record.status = "refused";
                record.code = "RESULT_NOT_ALLOWLISTED";
              } else if (error instanceof SyntaxError) {
                record.status = "refused";
                record.code = "ARGS_INVALID";
              } else {
                record.status = "error";
                record.code = "TOOL_ERROR";
              }
              content = JSON.stringify({ error: record.code });
            }
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    // ---- final call: strict schema, no tools ----
    const meta = newCallMeta();
    const state: LoopState = { messages, calls };
    let response;
    try {
      modelCalls++;
      response = await callChain(
        config.endpoints,
        (endpoint) => {
          const request = config.final.build(endpoint, state);
          const body = { ...request.body };
          delete body.tools;
          delete body.tool_choice;
          return { ...request, body, detectToolCalls: true };
        },
        config.roster,
        meta,
        config.options,
      );
    } catch (error) {
      absorb(meta);
      return finish("fallback", {
        fallbackReason: reasonFor(error, false, meta),
      });
    }
    absorb(meta);
    // A model that asks for another tool turn after the budget is refused.
    for (const extra of response.result.toolCalls ?? [])
      calls.push({
        seq: calls.length + 1,
        turn: turns + 1,
        tool: extra.name.slice(0, 64),
        args: truncatedArgs(extra.arguments),
        status: "refused",
        code: "TURN_LIMIT",
      });
    if (!response.result.content)
      return finish("fallback", {
        fallbackReason: "provider failed: MODEL_REQUESTED_EXTRA_TURN",
      });
    return finish("completed", {
      output: config.final.decode
        ? config.final.decode(response.result.content)
        : decodeModelContent(response.result.content),
    });
  } catch (error) {
    return finish("fallback", {
      fallbackReason: `provider failed: ${failureReason(error)}`,
    });
  }
}
