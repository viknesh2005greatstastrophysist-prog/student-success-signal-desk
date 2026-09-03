import { spawn } from "node:child_process";
import http from "node:http";

const publicPort = Number(process.env.PORT ?? 8080);
const upstreams = {
  governance: { port: 3110, workspace: "@aura/governance-portal" },
  identity: { port: 3120, workspace: "@aura/auth-server" },
  core: { port: 3130, workspace: "@aura/core-api" },
};

let shuttingDown = false;
const children = Object.entries(upstreams).map(([name, upstream]) => {
  const child = spawn(
    "npm",
    ["run", "start", "--workspace", upstream.workspace, "--", "--hostname", "127.0.0.1", "--port", String(upstream.port)],
    { env: { ...process.env, PORT: String(upstream.port) }, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`[control-plane] ${name} exited (${signal ?? code ?? "unknown"})\n`);
    shutdown(1);
  });
  return child;
});

function targetFor(request) {
  const pathname = new URL(request.url ?? "/", "http://control-plane.invalid").pathname;
  if (pathname === "/api/auth/callback/aura") return upstreams.governance;
  if (pathname === "/api/identity-health") return { ...upstreams.identity, path: "/api/health" };
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/demo/") || pathname === "/sign-in" || pathname === "/consent") {
    return upstreams.identity;
  }
  if (pathname.startsWith("/_next/") && /\/(sign-in|consent)(?:[/?#]|$)/.test(request.headers.referer ?? "")) return upstreams.identity;
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) return upstreams.core;
  return upstreams.governance;
}

const server = http.createServer((request, response) => {
  const target = targetFor(request);
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: target.port,
    path: target.path ?? request.url,
    method: request.method,
    headers: {
      ...request.headers,
      "x-forwarded-host": request.headers.host ?? "",
      "x-forwarded-proto": "https",
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => {
    if (response.headersSent) return response.destroy(error);
    response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: false, error: { code: "CONTROL_PLANE_STARTING", message: "The control plane is starting. Retry shortly." } }));
  });
  request.pipe(upstream);
});

server.listen(publicPort, "0.0.0.0", () => {
  process.stdout.write(`[control-plane] listening on ${publicPort}\n`);
});

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 5_000).unref();
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
