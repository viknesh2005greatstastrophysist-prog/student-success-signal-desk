import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Rebuild the Streamlit engine to a temp file and byte-compare it with the
// committed bundle; the committed manifest must describe the same inputs.
const platform = fileURLToPath(new URL("..", import.meta.url));
const temp = join(tmpdir(), `aura-engine-check-${process.pid}.mjs`);
try {
  const summary = JSON.parse(
    execFileSync(process.execPath, ["scripts/build-streamlit-engine.mjs", "--out", temp], { cwd: platform, encoding: "utf8" }).trim().split("\n").at(-1),
  );
  const [fresh, committed] = await Promise.all([
    readFile(temp),
    readFile(join(platform, "../streamlit_app/engine.mjs")),
  ]);
  const problems = [];
  const manifest = await readFile(join(platform, "../streamlit_app/engine-build.json"), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => (problems.push("streamlit_app/engine-build.json is missing or unreadable"), {}));
  if (!fresh.equals(committed)) problems.push("streamlit_app/engine.mjs is stale: rebuild with `node scripts/build-streamlit-engine.mjs`");
  if (manifest.inputsSha256 !== summary.inputsSha256) problems.push("engine-build.json inputsSha256 does not match the current sources");
  if (manifest.engineSha256 !== summary.engineSha256) problems.push("engine-build.json engineSha256 does not match the rebuilt bundle");
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "passed", bytes: summary.bytes, inputsSha256: summary.inputsSha256 }));
} finally {
  await rm(temp, { force: true });
}
