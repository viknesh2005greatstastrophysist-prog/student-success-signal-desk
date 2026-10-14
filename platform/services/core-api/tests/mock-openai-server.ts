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
