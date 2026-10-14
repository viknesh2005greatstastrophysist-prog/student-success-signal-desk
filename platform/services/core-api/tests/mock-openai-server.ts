import { createServer, type IncomingMessage } from "node:http";

/** Deterministic local OpenAI-compatible server for Chapter 11 provider tests.
 * Routes are keyed by path prefix (e.g. "/groq", "/gemini"); each route plays a
 * queue of scripted replies and records every request body it receives. */
export type MockReply = {
  status?: number;
  headers?: Record<string, string>;
  /** chat-completion message content (string) or a raw JSON body */
  content?: string;
  body?: unknown;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};
export type MockRoute = {
  replies: Array<MockReply | ((request: unknown) => MockReply)>;
  requests: Array<{ body: unknown; raw: string; authorization?: string }>;
};

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockOpenAI(routes: Record<string, MockRoute>) {
  const server = createServer(async (request, response) => {
    const raw = await read(request);
    const prefix = Object.keys(routes).find((p) =>
      request.url?.startsWith(`${p}/`),
    );
    const route = prefix ? routes[prefix] : undefined;
    if (!route || !request.url?.endsWith("/chat/completions")) {
      response.writeHead(404).end("{}");
      return;
    }
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    route.requests.push({
      body,
      raw,
      authorization: request.headers.authorization,
    });
    const next = route.replies.length > 1 ? route.replies.shift()! : route.replies[0]!;
    const reply = typeof next === "function" ? next(body) : next;
    response.writeHead(reply.status ?? 200, {
      "Content-Type": "application/json",
      ...(reply.headers ?? {}),
    });
    response.end(
      JSON.stringify(
        reply.body ?? {
          choices: [{ message: { content: reply.content ?? "{}" } }],
          usage: reply.usage ?? {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    url: (prefix: string) => `http://127.0.0.1:${address.port}${prefix}/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
      );
    },
  };
}
export const route = (...replies: MockRoute["replies"]): MockRoute => ({
  replies,
  requests: [],
});

/* ---- tool-calling helpers (Brief 12) ---- */
export const toolCallReply = (
  calls: Array<{ name: string; args: unknown; id?: string }>,
): MockReply => ({
  body: {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: c.id ?? `call_9f3a2b1${i}`,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  },
});
export const toolsUnsupported: MockReply = {
  status: 400,
  body: { error: { message: "tools are not supported by this model", type: "invalid_request_error" } },
};
type Body = {
  tools?: unknown;
  response_format?: { json_schema?: { name?: string } };
  messages?: Array<{ role: string; content: string | null }>;
};
export const hasTools = (body: unknown) => Array.isArray((body as Body)?.tools);
export const schemaName = (body: unknown) =>
  (body as Body)?.response_format?.json_schema?.name;
/** The user payload of a request, parsed (the first user message). */
export const userPayload = (body: unknown): DraftPayload =>
  JSON.parse(
    (body as Body).messages!.find((m) => m.role === "user")!.content as string,
  );

type DraftRow = { ref: string; source: string; metric: string; value: number; course?: string };
type DraftSignal = { code: string; evidence: string; value: number; threshold: number };
/** The parts of an egress draft payload the scripted models read. */
export type DraftPayload = {
  case: string;
  evidence: DraftRow[];
  signals: DraftSignal[];
  catalogue: Array<{ code: string }>;
};
/** A valid, grounded packet-v2 draft built only from the request's own payload:
 * one sentence per signal and one per tool row, every number cited. */
export function groundedDraft(payload: DraftPayload, preferToolRows = true) {
  const evidence = payload.evidence;
  type Sig = DraftSignal;
  const sentence = (s: Sig) =>
    `The ${s.code.toLowerCase().replaceAll("_", " ")} indicator is ${s.value} against the ${s.threshold} threshold.`;
  const signals = payload.signals;
  // at most four sentences for signals: any remainder shares the last one
  const head = signals.length > 4 ? signals.slice(0, 3) : signals;
  const rest = signals.length > 4 ? signals.slice(3) : [];
  const rationale = head.map((s) => ({ text: sentence(s), citations: [s.evidence] }));
  if (rest.length)
    rationale.push({
      text: rest.map(sentence).join(" ").slice(0, 320),
      citations: rest.map((s) => s.evidence),
    });
  const toolRows = preferToolRows ? evidence.filter((e) => e.source === "tools") : [];
  const row = toolRows[0] ?? evidence.find((e) => !rationale.some((r) => r.citations.includes(e.ref)));
  const related = row
    ? toolRows.filter((t) => t.metric === row.metric && t.course === row.course)
    : [];
  if (row)
    rationale.push({
      text: `A closer look shows ${row.metric} at ${row.value}${row.course ? ` in ${row.course}` : ""}.`,
      citations: [row.ref],
    });
  const codes = payload.catalogue.map((c) => c.code);
  const cite = [...new Set([...rationale.flatMap((r) => r.citations), ...related.map((r) => r.ref)])].slice(0, 6);
  return {
    rationale: rationale.slice(0, 5),
    actions: codes.slice(0, 2).map((code, i) => ({
      code,
      personalisation: `Talk through the ${row ? row.value : "flagged"} figure together and agree one concrete next step.`,
      talkingPoints: ["What would make the next fortnight easier to manage?"],
      dueInDays: 7 + i,
      citations: row ? [row.ref] : cite,
    })),
    _tools: toolRows.map((t) => t.ref),
  };
}
export const draftReply = (payload: DraftPayload, usage = 300): MockReply => {
  const { _tools, ...draft } = groundedDraft(payload);
  void _tools;
  return {
    content: JSON.stringify(draft),
    usage: { prompt_tokens: usage, completion_tokens: 100, total_tokens: usage + 100 },
  };
};
