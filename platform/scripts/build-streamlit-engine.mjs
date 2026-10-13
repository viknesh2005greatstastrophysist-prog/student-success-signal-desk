import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const result = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ["scripts/streamlit-worker.mts"],
  outfile: "../streamlit_app/engine.mjs",
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
const enginePath = "../streamlit_app/engine.mjs";
const code = (await readFile(enginePath, "utf8")).replace(/^[\t ]+$/gm, "");
await writeFile(enginePath, code);
await writeFile(
  "../runtime/streamlit-project/engine-build.json",
  JSON.stringify(
    {
      status: "passed",
      inputFiles: Object.keys(result.metafile.inputs).length,
      bytes: result.metafile.outputs["../streamlit_app/engine.mjs"].bytes,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
