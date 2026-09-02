import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    assert.equal(contract.coreApiAudience, "aura-core-api");
    clientIds.push(contract.oidcClientId);
  }
  assert.equal(new Set(clientIds).size, 5);
});
