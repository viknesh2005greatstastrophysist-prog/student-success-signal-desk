import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { coreApiAudience, portalOidcClients } from "@aura/contracts";

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
    names.push(pkg.name);
  }
  assert.equal(new Set(names).size, 5);
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
