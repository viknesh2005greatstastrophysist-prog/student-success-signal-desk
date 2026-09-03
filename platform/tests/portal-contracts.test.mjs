import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { coreApiAudience, portalOidcClients, resolvePortalOrigins } from "@aura/contracts";

const root = fileURLToPath(new URL("..", import.meta.url));
const expected = ["student", "parent", "faculty", "hod", "governance"];

test("exactly five independent portal workspaces are declared", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*", "services/*"]);

  const names = [];
  for (const portal of expected) {
    const pkg = JSON.parse(await readFile(join(root, "apps", `${portal}-portal`, "package.json"), "utf8"));
    assert.equal(pkg.private, true);
    assert.ok(pkg.scripts.build);
    assert.equal(pkg.scripts.start, "next start");
    names.push(pkg.name);
  }
  assert.equal(new Set(names).size, 5);
});

test("the five-service Railway topology preserves the independent portals and control-plane boundaries", async () => {
  const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts["start:railway-control-plane"], "node scripts/railway-control-plane.mjs");
  for (const service of ["auth-server", "core-api"]) {
    const pkg = JSON.parse(await readFile(join(root, "services", service, "package.json"), "utf8"));
    assert.equal(pkg.scripts.start, "next start");
  }

  const gateway = await readFile(join(root, "scripts/railway-control-plane.mjs"), "utf8");
  assert.match(gateway, /pathname === "\/api\/auth\/callback\/aura"/);
  assert.match(gateway, /pathname\.startsWith\("\/api\/auth\/"\)/);
  assert.match(gateway, /pathname\.startsWith\("\/api\/v1\/"\)/);
  assert.ok(
    gateway.indexOf('pathname === "/api/auth/callback/aura"') < gateway.indexOf('pathname.startsWith("/api/auth/")'),
    "the portal callback must win before the Identity catch-all",
  );
});

test("every portal carries an independent client and release contract", async () => {
  const clientIds = [];
  for (const portal of expected) {
    const contract = JSON.parse(await readFile(join(root, "apps", `${portal}-portal`, "portal.json"), "utf8"));
    assert.equal(contract.id, portal);
    assert.match(contract.localOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(contract.vercelProject, /^aura-/);
    assert.match(contract.oidcClientId, /^[A-Za-z0-9]{24,}$/);
    assert.equal(contract.coreApiAudience, coreApiAudience);
    assert.equal(contract.oidcClientId, portalOidcClients[portal]);
    clientIds.push(contract.oidcClientId);
  }
  assert.equal(new Set(clientIds).size, 5);
});

test("alternate deployment origins remain role-mapped and HTTPS-only", () => {
  const origins = resolvePortalOrigins(JSON.stringify({
    student: "https://student.example.test",
    governance: ["https://governance.example.test/"],
  }));
  assert.ok(origins.student.includes("https://student.example.test"));
  assert.ok(origins.governance.includes("https://governance.example.test"));
  assert.ok(origins.parent.includes("https://aura-parent-portal.vercel.app"));
  assert.throws(() => resolvePortalOrigins('{"student":"http://student.example.test"}'), /HTTPS origin/);
  assert.throws(() => resolvePortalOrigins('{"admin":"https://admin.example.test"}'), /Unknown portal/);
});

test("every public surface uses the shared browser security policy", async () => {
  const configurations = [
    ...expected.map((portal) => `apps/${portal}-portal/next.config.ts`),
    "services/core-api/next.config.ts",
  ];
  for (const path of configurations) {
    const source = await readFile(join(root, path), "utf8");
    assert.match(source, /headers:\s*auraSecurityHeaders/, `${path} does not apply the shared security headers`);
    assert.match(source, /poweredByHeader:\s*false/, `${path} still exposes the framework header`);
    if (path.startsWith("apps/")) assert.match(source, /rewrites:\s*auraPortalRewrites/, `${path} does not preserve its approved deep links`);
  }
  const identityConfiguration = await readFile(join(root, "services/auth-server/next.config.ts"), "utf8");
  assert.match(identityConfiguration, /headers:\s*auraIdentitySecurityHeaders/, "Identity does not apply its portal-return security policy");
  assert.match(identityConfiguration, /poweredByHeader:\s*false/, "Identity still exposes the framework header");

  const policy = await readFile(join(root, "next-security.ts"), "utf8");
  for (const header of [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]) assert.match(policy, new RegExp(header), `${header} is missing from the shared policy`);
});

test("the OAuth callback finishes through a no-referrer navigation document", async () => {
  const source = await readFile(join(root, "packages/portal-kit/src/server.ts"), "utf8");
  assert.match(source, /completeBrowserNavigation\(destination\)/);
  assert.match(source, /<meta name="referrer" content="no-referrer">/);
  assert.match(source, /<meta http-equiv="refresh"/);
  assert.match(source, /response\.headers\.set\("Referrer-Policy", "no-referrer"\)/);
});
