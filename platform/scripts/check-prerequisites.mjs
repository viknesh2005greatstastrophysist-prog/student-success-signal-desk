import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const expectedPortals = ["student", "parent", "faculty", "hod", "governance"];
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
record("Node.js >= 20.9", nodeMajor >= 20, process.versions.node);

for (const portal of expectedPortals) {
  const packagePath = join(root, "apps", `${portal}-portal`, "package.json");
  try {
    await access(packagePath);
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    record(`${portal} portal workspace`, Boolean(pkg.scripts?.build), pkg.name);
  } catch (error) {
    record(`${portal} portal workspace`, false, error.message);
  }
}

for (const file of [
  "../docs/MULTI_PORTAL_ARCHITECTURE.md",
  "../docs/FIVE_PORTAL_ACCEPTANCE_CONTRACT.md",
  ".env.example",
  "services/auth-server/package.json",
  "services/core-api/package.json",
  "services/core-api/migrations/001_core.sql",
]) {
  try {
    await access(join(root, file));
    record(file, true, "present");
  } catch {
    record(file, false, "missing");
  }
}

for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
}

if (results.some((result) => !result.ok)) process.exitCode = 1;
