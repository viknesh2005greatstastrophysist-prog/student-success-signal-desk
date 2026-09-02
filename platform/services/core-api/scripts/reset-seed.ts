import { closePool } from "../lib/db";
import { resetSyntheticSeed } from "../lib/reset";

const confirmation = process.argv[2] ?? process.env.CORE_RESET_CONFIRMATION ?? "";

try {
  const manifest = await resetSyntheticSeed(confirmation, process.env.USER ?? "local-operator");
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await closePool();
}
