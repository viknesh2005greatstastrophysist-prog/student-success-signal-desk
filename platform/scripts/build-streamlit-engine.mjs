import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Usage: node scripts/build-streamlit-engine.mjs [--out <path>]
// Without --out the committed bundle streamlit_app/engine.mjs and its manifest
// streamlit_app/engine-build.json are rewritten. With --out only the bundle is
// written (used by `npm run check:engine`); a JSON summary goes to stdout.
const callerCwd = process.cwd();
const flag = process.argv.indexOf("--out");
if (flag >= 0 && !process.argv[flag + 1]) throw new Error("--out needs a path");
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const committed = resolve("../streamlit_app/engine.mjs");
const outPath = flag >= 0 ? resolve(callerCwd, process.argv[flag + 1]) : committed;
await mkdir(dirname(outPath), { recursive: true });
const result = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["scripts/streamlit-worker.mts"],
  outfile: outPath,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["pg-native"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
  tsconfig: "services/core-api/tsconfig.json",
  metafile: true,
});
const code = (await readFile(outPath, "utf8")).replace(/^[\t ]+$/gm, "");
await writeFile(outPath, code);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const inputs = Object.keys(result.metafile.inputs).sort();
const hash = createHash("sha256");
for (const file of inputs) {
  hash.update(file).update("\0");
  try {
    hash.update(await readFile(file));
  } catch {
    /* virtual esbuild input: its name is hashed */
  }
  hash.update("\0");
}
const summary = {
  inputFiles: inputs.length,
  inputsSha256: hash.digest("hex"),
  bytes: Buffer.byteLength(code),
  engineSha256: sha256(code),
};
if (outPath !== committed) {
  console.log(JSON.stringify(summary));
} else {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const manifest = {
    status: "passed",
    sourceCommit: git("rev-parse", "HEAD"),
    // true when built from uncommitted edits on top of sourceCommit; the
    // inputs hash is the exact identity that `npm run check:engine` verifies.
    sourceTreeDirty:
      git("status", "--porcelain", "--untracked-files=no", "--", ".", "../streamlit_app").length > 0,
    bundle: relative(resolve(".."), committed),
    ...summary,
  };
  await writeFile(
    "../streamlit_app/engine-build.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await mkdir("../runtime/streamlit-project", { recursive: true });
  await writeFile(
    "../runtime/streamlit-project/engine-build.json",
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
}
