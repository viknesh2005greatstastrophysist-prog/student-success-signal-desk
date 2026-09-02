import { createHash, randomBytes, randomUUID } from "node:crypto";
import { coreApiAudience, portalOidcClients, type PortalId } from "@aura/contracts";
import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify } from "jose";

type PortalTransaction = { state: string; nonce: string; verifier: string; returnTo: string };
type PortalSession = { accessToken: string; refreshToken?: string; subject: string; expiresAt: number };

const productionOrigins: Record<PortalId, string> = {
  student: "https://aura-student-portal.vercel.app",
  parent: "https://aura-parent-portal.vercel.app",
  faculty: "https://aura-faculty-portal.vercel.app",
  hod: "https://aura-hod-portal.vercel.app",
  governance: "https://aura-ai-governance.vercel.app",
};
const localOrigins: Record<PortalId, string> = {
  student: "http://127.0.0.1:3101",
  parent: "http://127.0.0.1:3102",
  faculty: "http://127.0.0.1:3103",
  hod: "http://127.0.0.1:3104",
  governance: "http://127.0.0.1:3105",
};

function settings(portal: PortalId) {
  const production = process.env.NODE_ENV === "production";
  return {
    clientId: portalOidcClients[portal],
    origin: production ? process.env.PORTAL_ORIGIN ?? productionOrigins[portal] : process.env.LOCAL_PORTAL_ORIGIN ?? localOrigins[portal],
    identityUrl: production ? process.env.AURA_IDENTITY_URL ?? "https://aura-identity-service.vercel.app" : process.env.LOCAL_AURA_IDENTITY_URL ?? "http://127.0.0.1:3200",
    coreUrl: production ? process.env.CORE_API_URL ?? "https://aura-core-api.vercel.app" : process.env.LOCAL_CORE_API_URL ?? "http://127.0.0.1:3300",
    secret: process.env.PORTAL_SESSION_SECRET,
    secure: production,
  };
}

function key(secret: string | undefined) {
  if (!secret || secret.length < 32) throw new Error("PORTAL_SESSION_SECRET must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

function base64url(input: Uint8Array) { return Buffer.from(input).toString("base64url"); }
function challenge(verifier: string) { return base64url(createHash("sha256").update(verifier).digest()); }
function cookieName(portal: PortalId, kind: "tx" | "session", secure: boolean) {
  return `${secure ? "__Host-" : ""}aura-${portal}-${kind}`;
}
function cookie(name: string, value: string, secure: boolean, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function readCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const item of raw.split(";")) {
    const [candidate, ...value] = item.trim().split("=");
    if (candidate === name) return value.join("=");
  }
  return undefined;
}
function safeReturnTo(raw: string | null) { return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/"; }
function redirect(location: string | URL, status = 302) {
  return new Response(null, { status, headers: { Location: location.toString() } });
}

async function seal(payload: object, secret: string, audience: string, expiresIn: string) {
  return new EncryptJWT({ ...payload }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setAudience(audience).setExpirationTime(expiresIn).encrypt(key(secret));
}
async function open<T>(token: string, secret: string, audience: string): Promise<T> {
  const result = await jwtDecrypt(token, key(secret), { audience });
  return result.payload as T;
}

export async function beginPortalLogin(request: Request, portal: PortalId) {
  const config = settings(portal);
  const state = base64url(randomBytes(24));
  const nonce = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(48));
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const transaction = await seal({ state, nonce, verifier, returnTo }, config.secret!, `${portal}:oidc-transaction`, "10m");
  const callback = `${config.origin}/api/auth/callback/aura`;
  const authorize = new URL("/api/auth/oauth2/authorize", config.identityUrl);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile email offline_access");
  authorize.searchParams.set("resource", coreApiAudience);
  authorize.searchParams.set("code_challenge", challenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("prompt", "login");
  const response = redirect(authorize, 302);
  response.headers.append("Set-Cookie", cookie(cookieName(portal, "tx", config.secure), transaction, config.secure, 600));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function finishPortalLogin(request: Request, portal: PortalId) {
  const config = settings(portal);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const transactionCookie = readCookie(request, cookieName(portal, "tx", config.secure));
  if (!code || !state || !transactionCookie) return redirect(`${config.origin}/?authError=missing_transaction`, 303);

  let transaction: PortalTransaction;
  try { transaction = await open<PortalTransaction>(transactionCookie, config.secret!, `${portal}:oidc-transaction`); }
  catch { return redirect(`${config.origin}/?authError=expired_transaction`, 303); }
  if (transaction.state !== state) return redirect(`${config.origin}/?authError=state_mismatch`, 303);

  const tokenResponse = await fetch(`${config.identityUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: `${config.origin}/api/auth/callback/aura`,
      code_verifier: transaction.verifier,
      resource: coreApiAudience,
    }),
    cache: "no-store",
  });
  const tokens = await tokenResponse.json().catch(() => null) as null | {
    access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number;
  };
  if (!tokenResponse.ok || !tokens?.access_token || !tokens.id_token) {
    return redirect(`${config.origin}/?authError=token_exchange_failed`, 303);
  }

  const discovery = await fetch(`${config.identityUrl}/api/auth/.well-known/openid-configuration`, { cache: "force-cache" });
  if (!discovery.ok) return redirect(`${config.origin}/?authError=discovery_failed`, 303);
  const metadata = await discovery.json() as { issuer: string; jwks_uri: string };
  let verified;
  try {
    verified = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), {
      issuer: metadata.issuer,
      audience: config.clientId,
    });
  } catch {
    return redirect(`${config.origin}/?authError=id_token_invalid`, 303);
  }
  if (verified.payload.nonce !== transaction.nonce || !verified.payload.sub) {
    return redirect(`${config.origin}/?authError=nonce_mismatch`, 303);
  }

  const expiresIn = Math.min(Number(tokens.expires_in ?? 3600), 3600);
  const session = await seal(
    { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, subject: verified.payload.sub, expiresAt: Date.now() + expiresIn * 1000 },
    config.secret!,
    `${portal}:portal-session`,
    `${expiresIn}s`,
  );
  const destination = new URL(transaction.returnTo, config.origin);
  const response = redirect(destination, 303);
  response.headers.append("Set-Cookie", cookie(cookieName(portal, "session", config.secure), session, config.secure, expiresIn));
  response.headers.append("Set-Cookie", cookie(cookieName(portal, "tx", config.secure), "", config.secure, 0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function readSession(request: Request, portal: PortalId) {
  const config = settings(portal);
  const raw = readCookie(request, cookieName(portal, "session", config.secure));
  if (!raw) return undefined;
  try { return await open<PortalSession>(raw, config.secret!, `${portal}:portal-session`); }
  catch { return undefined; }
}

function sameOrigin(request: Request, portal: PortalId) {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  return origin ? new URL(origin).origin === settings(portal).origin : false;
}

export async function portalDashboard(request: Request, portal: PortalId) {
  const session = await readSession(request, portal);
  if (!session) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } }, { status: 401 });
  const childId = new URL(request.url).searchParams.get("childId");
  const coreDashboard = new URL("/api/v1/dashboard", settings(portal).coreUrl);
  if (childId) coreDashboard.searchParams.set("childId", childId);
  const response = await fetch(coreDashboard, {
    headers: { Authorization: `Bearer ${session.accessToken}`, "X-Request-Id": randomUUID() },
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function portalPublishAndAssign(request: Request, portal: PortalId, offeringId: string) {
  if (!sameOrigin(request, portal)) return Response.json({ ok: false, error: { code: "CSRF_REJECTED", message: "Request origin rejected" } }, { status: 403 });
  const session = await readSession(request, portal);
  if (!session) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } }, { status: 401 });
  const response = await fetch(`${settings(portal).coreUrl}/api/v1/offerings/${encodeURIComponent(offeringId)}/publish-and-assign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": request.headers.get("idempotency-key") ?? randomUUID(),
    },
    body: await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function portalCoreCommand(request: Request, portal: PortalId, path: string) {
  if (!sameOrigin(request, portal)) return Response.json({ ok: false, error: { code: "CSRF_REJECTED", message: "Request origin rejected" } }, { status: 403 });
  const session = await readSession(request, portal);
  if (!session) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } }, { status: 401 });
  const response = await fetch(`${settings(portal).coreUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": request.headers.get("idempotency-key") ?? randomUUID(),
    },
    body: await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export function portalRegister(request: Request, portal: PortalId) {
  return portalCoreCommand(request, portal, "/api/v1/registrations");
}

export function portalWithdrawRegistration(request: Request, portal: PortalId, registrationId: string) {
  return portalCoreCommand(request, portal, `/api/v1/registrations/${encodeURIComponent(registrationId)}/withdraw`);
}

export function portalSubmitAttendance(request: Request, portal: PortalId, sessionId: string) {
  return portalCoreCommand(request, portal, `/api/v1/attendance-sessions/${encodeURIComponent(sessionId)}/submit`);
}

export function portalPublishMarks(request: Request, portal: PortalId, assessmentId: string) {
  return portalCoreCommand(request, portal, `/api/v1/assessments/${encodeURIComponent(assessmentId)}/marks`);
}

export function portalCreatePaymentAttempt(request: Request, portal: PortalId, invoiceId: string) {
  return portalCoreCommand(request, portal, `/api/v1/fees/invoices/${encodeURIComponent(invoiceId)}/payment-attempts`);
}

export function portalRevokeParentGrant(request: Request, portal: PortalId, grantId: string) {
  return portalCoreCommand(request, portal, `/api/v1/parent-grants/${encodeURIComponent(grantId)}/revoke`);
}

export function portalProcessAcademicEvent(request: Request, portal: PortalId) {
  return portalCoreCommand(request, portal, "/api/v1/governance/runs");
}

export function portalReplayAgentRun(request: Request, portal: PortalId, runId: string) {
  return portalCoreCommand(request, portal, `/api/v1/governance/runs/${encodeURIComponent(runId)}/replay`);
}

export function portalResetSimulation(request: Request, portal: PortalId) {
  return portalCoreCommand(request, portal, "/api/v1/governance/simulation/reset");
}

export function portalDecideSupportCase(request: Request, portal: PortalId, caseId: string) {
  return portalCoreCommand(request, portal, `/api/v1/support/cases/${encodeURIComponent(caseId)}/decisions`);
}

export async function portalDownloadRunEvidence(request: Request, portal: PortalId, runId: string) {
  const session = await readSession(request, portal);
  if (!session) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } }, { status: 401 });
  const response = await fetch(`${settings(portal).coreUrl}/api/v1/governance/runs/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, "X-Request-Id": randomUUID() }, cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) return Response.json(result, { status: response.status });
  return new Response(`${JSON.stringify(result, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="AURA-run-${runId}-evidence.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export async function portalDownloadReceipt(request: Request, portal: PortalId, receiptId: string) {
  const session = await readSession(request, portal);
  if (!session) return Response.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to continue" } }, { status: 401 });
  const response = await fetch(`${settings(portal).coreUrl}/api/v1/receipts/${encodeURIComponent(receiptId)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, "X-Request-Id": randomUUID() },
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; data?: Record<string, unknown>; error?: unknown } | null;
  if (!response.ok || !result?.ok || !result.data) {
    return Response.json(result ?? { ok: false, error: { code: "RECEIPT_UNAVAILABLE", message: "Receipt could not be generated" } }, { status: response.status || 502 });
  }
  const item = result.data;
  const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(item.amountPaise) / 100);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>AURA sandbox receipt</title><style>body{margin:0;padding:56px;background:#f6efe1;color:#29271f;font:16px/1.6 system-ui,sans-serif}.receipt{max-width:720px;margin:auto;padding:48px;border:1px solid #b9ad99;background:#fffdf8}.eyebrow{font:12px monospace;letter-spacing:.14em;text-transform:uppercase;color:#9a4f25}h1{font:500 48px Georgia,serif;margin:12px 0 36px}.row{display:flex;justify-content:space-between;gap:30px;padding:14px 0;border-top:1px solid #ded6c9}.total{font-size:24px;font-weight:700}.notice{margin-top:34px;padding:14px;border-left:3px solid #9a4f25;background:#f6efe1;font-size:13px}</style><body><main class="receipt"><p class="eyebrow">AURA Institute of Technology</p><h1>Payment receipt</h1><div class="row"><span>Student</span><b>${escapeHtml(item.studentName)} · ${escapeHtml(item.registerNumber)}</b></div><div class="row"><span>Invoice</span><b>${escapeHtml(item.invoiceNumber)}</b></div><div class="row"><span>Term</span><b>${escapeHtml(item.term)}</b></div><div class="row"><span>Description</span><b>${escapeHtml(item.description)}</b></div><div class="row"><span>Reference</span><b>${escapeHtml(item.providerReference)}</b></div><div class="row"><span>Paid at</span><b>${escapeHtml(item.paidAt)}</b></div><div class="row total"><span>Total paid</span><b>${escapeHtml(amount)}</b></div><p class="notice">Sandbox simulation only. No money was transferred and this is not a real tax receipt.</p></main></body></html>`;
  const safeId = String(item.invoiceNumber ?? receiptId).replace(/[^A-Za-z0-9_-]/g, "-");
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="AURA-${safeId}-receipt.html"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function endPortalSession(request: Request, portal: PortalId) {
  const config = settings(portal);
  if (!sameOrigin(request, portal)) return new Response("Request origin rejected", { status: 403 });
  const session = await readSession(request, portal);
  if (session?.refreshToken) {
    await fetch(`${config.identityUrl}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken, token_type_hint: "refresh_token", client_id: config.clientId }),
      cache: "no-store",
    }).catch(() => undefined);
  }
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", cookie(cookieName(portal, "session", config.secure), "", config.secure, 0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
