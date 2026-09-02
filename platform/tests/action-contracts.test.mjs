import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { actionManifest } from "@aura/contracts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every interactive control is named and every action contract is rendered", async () => {
  const ids = actionManifest.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
  const sources = await Promise.all([
    "packages/portal-kit/src/index.tsx",
    "services/auth-server/app/page.tsx",
    "services/auth-server/app/sign-in/page.tsx",
    "services/auth-server/app/consent/consent-client.tsx",
  ].map((path) => readFile(join(root, path), "utf8")));
  const source = sources.join("\n");
  const rendered = [...source.matchAll(/data-action-id="([^"]+)"/g)].map((match) => match[1]);
  for (const actionId of rendered) assert.ok(ids.includes(actionId), `${actionId} is missing from the action manifest`);
  for (const line of source.split("\n").filter((item) => /<(button|a|select|input|textarea)\b/.test(item) && !/<input\b[^>]*type="hidden"/.test(item))) {
    assert.match(line, /data-action-id=/, `interactive control has no action id: ${line.trim().replace(/\s+/g, " ").slice(0, 160)}`);
  }
  const dynamicViews = {
    student: ["today", "registration", "academics", "fees", "support", "account"],
    parent: ["overview", "children", "fees", "access"],
    faculty: ["today", "classrooms", "gradebook", "cases"],
    hod: ["department", "offerings", "people", "cases"],
    governance: ["operations", "runs", "evidence", "simulation"],
  };
  const dynamicRendered = new Set([
    ...["student", "parent", "faculty", "hod", "governance"].flatMap((portal) => ["sign-in", "refresh", "sign-out", "retry", "open-activity-consequence"].map((action) => `${portal}-${action}`)),
    ...Object.entries(dynamicViews).flatMap(([portal, views]) => views.map((view) => `${portal}-open-${view}`)),
  ]);
  const allRendered = new Set([...rendered, ...dynamicRendered]);
  for (const actionId of ids) assert.ok(allRendered.has(actionId), `${actionId} is declared but never rendered`);
  assert.doesNotMatch(source, /href=["']#["']/);
  assert.doesNotMatch(source, /onClick=\{\(\) => \{\s*\}\}/);
});
