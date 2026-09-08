import { NextResponse } from "next/server";

import { demoPersonaForClient } from "@/lib/demo-personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithError(request: Request, code: string) {
  const target = new URL("/sign-in", request.url);
  const source = new URL(request.url);
  source.searchParams.forEach((value, key) => target.searchParams.append(key, value));
  target.searchParams.set("error", code);
  return NextResponse.redirect(target, 303);
}

export async function POST(request: Request) {
  const oauthParams = new URL(request.url).searchParams;
  oauthParams.delete("error");
  const rawOAuthQuery = oauthParams.toString();
  const configuredIdentity = process.env.NODE_ENV === "production"
    ? process.env.BETTER_AUTH_URL ?? request.url
    : process.env.LOCAL_BETTER_AUTH_URL ?? "http://127.0.0.1:3200";
  const expectedOrigin = new URL(configuredIdentity).origin;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== expectedOrigin) return new NextResponse("Origin rejected", { status: 403 });

  const form = await request.formData();
  const requestedPortal = String(form.get("persona") ?? "");
  const clientId = new URL(request.url).searchParams.get("client_id") ?? undefined;
  const persona = demoPersonaForClient(clientId);
  const password = process.env.DEMO_PERSONA_PASSWORD;

  if (!password || !persona || persona.portal !== requestedPortal) {
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

  const headers = new Headers(signedIn.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(signedIn.body, { status: signedIn.status, headers });
}
