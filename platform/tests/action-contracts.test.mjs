import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { actionManifest } from "@aura/contracts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("action manifest is unique and covers every literal rendered action", async () => {
  const ids = actionManifest.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
  const sources = await Promise.all([
    "packages/portal-kit/src/index.tsx",
    "services/auth-server/app/page.tsx",
    "services/auth-server/app/sign-in/page.tsx",
    "services/auth-server/app/consent/consent-client.tsx",
  ].map((path) => readFile(join(root, path), "utf8")));
  const rendered = [...sources.join("\n").matchAll(/data-action-id="([^"]+)"/g)].map((match) => match[1]);
  for (const actionId of rendered) assert.ok(ids.includes(actionId), `${actionId} is missing from the action manifest`);
  assert.doesNotMatch(sources.join("\n"), /href=["']#["']/);
  assert.doesNotMatch(sources.join("\n"), /onClick=\{\(\) => \{\s*\}\}/);
});
