import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CollegeAttendanceReview } from "./college-attendance-review";
import type { CollegePilot } from "./college-pilot-store";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";

export function createCollegeAttendanceServer(review: CollegeAttendanceReview, assets: { html: string; script: string; css: string }, pilot?: CollegePilot) {
  const json = JSON.stringify({ ...review, workflowAvailable: !!pilot });
  const sessions = new Map<string, { csrf: string; expires: number }>();
  const routes = new Map([
    ["/", ["text/html; charset=utf-8", assets.html]],
    ["/review.js", ["text/javascript; charset=utf-8", assets.script]],
    ["/review.css", ["text/css; charset=utf-8", assets.css]],
    ["/api/review", ["application/json; charset=utf-8", json]],
  ]);
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost) { res.writeHead(403).end("Open this review using its 127.0.0.1 address."); return; }
    if ((req.headers.origin && req.headers.origin !== `http://${expectedHost}`) || req.headers["sec-fetch-site"] === "cross-site") {
      res.writeHead(403).end("Open this review directly on this computer."); return;
    }
    if (pilot && req.url?.startsWith("/api/workflow")) {
      const send = (status: number, data: unknown) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.writeHead(status).end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
      try {
        const cookie = /(?:^|;\s*)aura_pilot=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
        let sessionId = cookie, session = cookie ? sessions.get(cookie) : undefined;
        if (req.url === "/api/workflow" && req.method === "GET") {
          if (!session || session.expires < Date.now()) {
            if (cookie) sessions.delete(cookie);
            sessionId = randomBytes(32).toString("hex"); session = { csrf: randomBytes(32).toString("hex"), expires: Date.now() + 3600000 };
            sessions.set(sessionId, session);
            res.setHeader("Set-Cookie", `aura_pilot=${sessionId}; Path=/api/workflow; HttpOnly; SameSite=Strict; Max-Age=3600`);
          }
          send(200, { ...pilot.overview(), csrf: session.csrf, actorRole: "local_project_operator" }); return;
        }
        if (!session || session.expires < Date.now() || !sessionId) { send(401, { error: "OPEN_WORKFLOW_FIRST" }); return; }
        const actor = `local_operator:${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}`;
        const matches = /^\/api\/workflow\/runs\/([a-f0-9-]+)(?:\/cases\/([a-f0-9-]+))?(?:\/(advance|pause|edit|approve|reject|withdraw|restore|followup|retry|replay|export|publish))?$/.exec(req.url);
        if (req.method === "GET" && matches?.[2] && (!matches[3] || matches[3] === "export")) {
          if (matches[3] === "export") res.setHeader("Content-Disposition", 'attachment; filename="private-college-case.json"');
          send(200, matches[3] ? pilot.exportCase(matches[1]!, matches[2]) : pilot.caseDetail(matches[1]!, matches[2])); return;
        }
        if (req.method !== "POST") { send(405, { error: "METHOD_NOT_ALLOWED" }); return; }
        if (req.headers.origin !== `http://${expectedHost}` || req.headers["x-aura-csrf"] !== session.csrf || !req.headers["content-type"]?.startsWith("application/json")) { send(403, { error: "CSRF_OR_ORIGIN_REJECTED" }); return; }
        let body = "";
        for await (const chunk of req) { body += String(chunk); if (Buffer.byteLength(body) > 65536) { send(413, { error: "REQUEST_TOO_LARGE" }); return; } }
        const input: unknown = JSON.parse(body || "{}");
        if (req.url === "/api/workflow/runs") {
          const raw = z.object({ mode: z.enum(["model", "deterministic"]), commandId: z.string().uuid() }).strict().parse(input);
          send(200, pilot.createRun(raw.mode, raw.commandId, actor)); return;
        }
        if (!matches) { send(404, { error: "ROUTE_NOT_FOUND" }); return; }
        const [, runId, studentId, action] = matches;
        if (!studentId && action === "advance") { z.object({}).strict().parse(input); send(200, await pilot.advance(runId!)); return; }
        if (!studentId && action === "pause") { const raw = z.object({ paused: z.boolean(), commandId: z.string().uuid() }).strict().parse(input); send(200, pilot.setPaused(runId!, raw.paused, raw.commandId, actor)); return; }
        if (!studentId) { send(404, { error: "ROUTE_NOT_FOUND" }); return; }
        if (action === "edit") send(200, pilot.edit(runId!, studentId, input, actor));
        else if (action === "approve" || action === "reject" || action === "withdraw" || action === "restore") send(200, pilot.decide(runId!, studentId, action, input, actor));
        else if (action === "followup") send(200, pilot.followup(runId!, studentId, input, actor));
        else if (action === "retry") { const raw = z.object({ commandId: z.string().uuid() }).strict().parse(input); send(200, pilot.retry(runId!, studentId, raw.commandId, actor)); }
        else if (action === "replay") { z.object({}).strict().parse(input); send(200, await pilot.replay(runId!, studentId)); }
        else if (action === "publish") pilot.publish(runId!, studentId);
        else send(404, { error: "ROUTE_NOT_FOUND" });
      } catch (error) {
        const code = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : "INVALID_REQUEST";
        send(code.includes("OUT_OF_SCOPE") || code.includes("NOT_FOUND") ? 404 : code === "INVALID_REQUEST" ? 400 : 409, { error: code });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); res.writeHead(405).end("This review is read-only."); return; }
    const route = routes.get(req.url ?? "");
    if (!route) { res.writeHead(404).end("Page not found."); return; }
    res.setHeader("Content-Type", route[0]!);
    res.writeHead(200).end(req.method === "HEAD" ? undefined : route[1]);
  });
}
