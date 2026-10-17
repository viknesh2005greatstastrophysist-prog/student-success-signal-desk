/**
 * Informational records backfill (spec conformance P2-5) for the CURRENT data generation:
 * LMS quiz scores, internship registration and evaluation, placement readiness,
 * applications and interview outcomes, for every student who has none yet.
 * Deterministic from the current data generation's seed and as-of time.
 *
 *   From platform/:
 *   npx tsx services/core-api/scripts/backfill-informational.ts --env <environment.json> migrate
 *   npx tsx services/core-api/scripts/backfill-informational.ts --env <environment.json> [--apply]
 *     [--exclude-email <email>]... [--exclude-case <case id prefix>]... [--out <file>]
 *
 * Commands
 *   migrate   apply the pending Core migrations (013 adds the three tables); nothing else
 *   (none)    the backfill: a dry run by default (counts what would be written, writes
 *             nothing); with --apply it writes in one transaction
 *
 * Never: a new data generation, a changed generation id, as-of or evidence capture time, an
 * update or delete of any existing row, or a record for a frozen student (student 021) or an
 * excluded one. Students who already have a record are skipped, so it is safe to run twice.
 * Prints counts only (no names, register numbers or ids). The environment file is loaded
 * into this process only; no connection detail is printed.
 */
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--env", "--exclude-email", "--exclude-case", "--out"]);
const BOOLEAN_FLAGS = new Set(["--apply", "--dry-run"]);
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (VALUE_FLAGS.has(a)) { if (args[i + 1] === undefined) throw new Error(`${a} needs a value`); i += 1; }
  else if (BOOLEAN_FLAGS.has(a)) continue;
  else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
  else positional.push(a);
}
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const many = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
const command = positional[0] ?? "backfill";
if (positional.length > 1 || !["migrate", "backfill"].includes(command)) throw new Error("Usage: backfill-informational.ts --env <environment.json> [migrate] [--apply]");
const apply = args.includes("--apply");
if (apply && args.includes("--dry-run")) throw new Error("Choose either --apply or --dry-run");
const envFile = flag("--env");
if (!envFile) throw new Error("Usage: backfill-informational.ts --env <environment.json> [migrate] [--apply]");
const env = JSON.parse(await readFile(envFile, "utf8")) as Record<string, string>;
Object.assign(process.env, env);
const url = new URL(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "");
const hosted = process.env.CORE_DATABASE_SCHEMA === "aura_hosted_project_core";
const local = process.env.CORE_DATABASE_SCHEMA === "aura_project_core";
if (local && (url.hostname !== "127.0.0.1" || url.port !== "55432")) throw new Error("The local project schema must be on the local database");
if (hosted && ["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The hosted project schema must be on the hosted database");
if (!local && !hosted) throw new Error("Only aura_project_core and aura_hosted_project_core may be backfilled");
if (hosted) (process.env as Record<string, string>).NODE_ENV = "production";

const { withCoreTransaction, withCoreSnapshot, closePool } = await import("../lib/db");
const { migrateCoreDatabase } = await import("../lib/migrations");
const { resolveStudentIds } = await import("../lib/data-refresh/apply");
const { planInformational } = await import("../lib/data-refresh/generator");
const { applyInformationalBackfill, backfillReport, loadInformationalBackfill } = await import("../lib/data-refresh/informational-apply");

const emit = async (value: unknown) => {
  const text = JSON.stringify(value, null, 2);
  console.log(text);
  const out = flag("--out");
  if (out) await writeFile(out, text + "\n", { mode: 0o600 });
};
async function excluded(): Promise<string[]> {
  const ids = new Set<string>();
  await withCoreSnapshot(async (c) => {
    for (const email of many("--exclude-email")) for (const id of await resolveStudentIds(c, { email })) ids.add(id);
    for (const caseIdPrefix of many("--exclude-case")) for (const id of await resolveStudentIds(c, { caseIdPrefix })) ids.add(id);
  });
  return [...ids];
}

try {
  const schema = process.env.CORE_DATABASE_SCHEMA;
  if (command === "migrate") {
    await migrateCoreDatabase();
    await emit({ schema, migrations: "current" });
  } else if (!apply) {
    const exclude = await excluded();
    const report = await withCoreSnapshot(async (c) => {
      const load = await loadInformationalBackfill(c, { excludeStudentIds: exclude });
      return backfillReport(load, planInformational(load.input));
    });
    await emit({ mode: "dry run (nothing written; add --apply to write)", schema, ...report });
  } else {
    const exclude = await excluded();
    const report = await withCoreTransaction(async (c) => {
      const load = await loadInformationalBackfill(c, { excludeStudentIds: exclude });
      return applyInformationalBackfill(c, load);
    }, "exclusive");
    await emit({ mode: "applied", schema, ...report });
  }
} finally {
  await closePool();
}
