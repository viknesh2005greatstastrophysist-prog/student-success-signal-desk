import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { demoPersonaForClient } from "@/lib/demo-personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetsAt: number }>();

function sameSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function redirectWithError(request: Request, code: string) {
  const target = new URL("/sign-in", request.url);
  const source = new URL(request.url);
  source.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  target.searchParams.set("error", code);
  return NextResponse.redirect(target, 303);
}

export async function POST(request: Request) {
  const rawOAuthQuery = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
  const configuredIdentity = process.env.NODE_ENV === "production"
    ? process.env.BETTER_AUTH_URL ?? request.url
    : process.env.LOCAL_BETTER_AUTH_URL ?? "http://127.0.0.1:3200";
  const expectedOrigin = new URL(configuredIdentity).origin;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== expectedOrigin) return new NextResponse("Origin rejected", { status: 403 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const limit = attempts.get(ip);
  if (limit && limit.resetsAt > now && limit.count >= 8) return new NextResponse("Try again later", { status: 429 });

  const form = await request.formData();
  const pin = String(form.get("pin") ?? "");
  const requestedPortal = String(form.get("persona") ?? "");
  const clientId = new URL(request.url).searchParams.get("client_id") ?? undefined;
  const persona = demoPersonaForClient(clientId);
  const expectedPin = process.env.DEMO_ACCESS_PIN;
  const password = process.env.DEMO_PERSONA_PASSWORD;

  if (!expectedPin || !password || !persona || persona.portal !== requestedPortal || !sameSecret(pin, expectedPin)) {
    attempts.set(ip, { count: limit && limit.resetsAt > now ? limit.count + 1 : 1, resetsAt: now + 15 * 60_000 });
    return redirectWithError(request, "access_denied");
  }

  const { auth } = await import("@/lib/auth");
  const signInHeaders = new Headers(request.headers);
  signInHeaders.set("content-type", "application/json");
  signInHeaders.set("accept", "text/html,application/xhtml+xml");
  const signedIn = await auth.handler(new Request(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers: signInHeaders,
    body: JSON.stringify({ email: persona.email, password, oauth_query: rawOAuthQuery }),
  }));
  if (signedIn.status >= 400) return redirectWithError(request, "session_failed");

  attempts.delete(ip);
  const headers = new Headers(signedIn.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(signedIn.body, { status: signedIn.status, headers });
}
