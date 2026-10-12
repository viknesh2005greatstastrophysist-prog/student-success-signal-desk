import { NextResponse } from "next/server";
import { portalOidcClients } from "@aura/contracts";
import { identityMode } from "@/lib/identity-mode";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const mode = identityMode();
  if (mode === "demo") return new NextResponse("Account sign-in is not enabled", { status: 403 });
  if (mode === "project" && !["127.0.0.1", "localhost"].includes(new URL(request.url).hostname)) return new NextResponse("Private local access required", { status: 403 });
  const expectedOrigin = new URL(process.env.NODE_ENV === "production" && process.env.AURA_LOCAL_PROJECT !== "1" ? process.env.BETTER_AUTH_URL ?? request.url : process.env.LOCAL_BETTER_AUTH_URL ?? "http://127.0.0.1:3200").origin;
  if (request.headers.get("origin") !== expectedOrigin) return new NextResponse("Origin rejected", { status: 403 });
  const query = new URL(request.url).searchParams;
  if (!Object.values(portalOidcClients).includes(query.get("client_id") ?? "")) return new NextResponse("Unknown portal client", { status: 400 });
  const values = await request.formData(), email = String(values.get("email") ?? ""), password = String(values.get("password") ?? "");
  if (!email || email.length > 254 || password.length < 10 || password.length > 256) return new NextResponse("Invalid sign-in input", { status: 400 });
  const { auth } = await import("@/lib/auth");
  const headers = new Headers(request.headers); headers.set("content-type", "application/json"); headers.set("accept", "text/html,application/xhtml+xml");
  const signedIn = await auth.handler(new Request(new URL("/api/auth/sign-in/email", request.url), { method: "POST", headers, body: JSON.stringify({ email, password, oauth_query: query.toString() }) }));
  if (signedIn.status >= 400) {
    const target = new URL("/sign-in", expectedOrigin); target.search = query.toString(); target.searchParams.set("error", signedIn.status===429?"rate_limited":"sign_in_failed");
    const response=NextResponse.redirect(target,303);if(signedIn.status===429)response.headers.set("Retry-After",signedIn.headers.get("Retry-After")??"10");return response;
  }
  const responseHeaders = new Headers(signedIn.headers); responseHeaders.set("Cache-Control", "no-store");
  return new Response(signedIn.body, { status: signedIn.status, headers: responseHeaders });
}
