/**
 * Check-ins for support plans approved before meeting records existed (owner request,
 * 17 Oct; lib/meetings.ts). Since then every approval creates one check-in; this adds
 * the missing one for each student's approved current plan (shown to the family, on the
 * current figures) that has no check-in linked to it, due 7 days after its approval,
 * assigned to the student's mentor, shared with the family, note "Check-in after the
 * support plan". A plan approved more than 7 days ago gets a check-in that is already
 * overdue, so its meeting shows at once on the mentor's Today.
 *
 *   From platform/:
 *   npx tsx services/core-api/scripts/backfill-meeting-checkins.ts --env <environment.json> migrate
 *   npx tsx services/core-api/scripts/backfill-meeting-checkins.ts --env <environment.json> [--apply]
 *     [--exclude-email <email>]... [--exclude-case <case id prefix>]... [--out <file>]
 *
 * Commands
 *   migrate   apply the pending Core migrations (014 adds support_meetings); nothing else
 *   (none)    the backfill: a dry run by default (counts what would be written, writes
 *             nothing); with --apply it writes in one transaction
 *
 * Never: an update or delete of any existing row, a second check-in for a plan that has
 * one, or a check-in for a frozen student (student 021) or an excluded one. Safe to run
 * twice: the second run finds nothing missing. Prints counts only (no names, register
 * numbers or ids). The environment file is loaded into this process only; no connection
 * detail is printed.
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
const USAGE = "Usage: backfill-meeting-checkins.ts --env <environment.json> [migrate] [--apply]";
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const many = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
const command = positional[0] ?? "backfill";
if (positional.length > 1 || !["migrate", "backfill"].includes(command)) throw new Error(USAGE);
const apply = args.includes("--apply");
if (apply && args.includes("--dry-run")) throw new Error("Choose either --apply or --dry-run");
const envFile = flag("--env");
if (!envFile) throw new Error(USAGE);
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
const { getCurrentGeneration } = await import("../lib/command-ledger");
const { resolveStudentIds } = await import("../lib/data-refresh/apply");
const { applyMissingCheckins, backfillDueOn, collegeDate, loadMissingCheckins } = await import("../lib/meetings");

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
  const today = collegeDate();
  if (command === "migrate") {
    await migrateCoreDatabase();
    await emit({ schema, migrations: "current" });
  } else if (!apply) {
    const exclude = await excluded();
    const missing = await withCoreSnapshot(async (c) => loadMissingCheckins(c, await getCurrentGeneration(c), exclude));
    await emit({
      mode: "dry run (nothing written; add --apply to write)",
      schema,
      excludedStudents: exclude.length,
      checkinsToCreate: missing.length,
      alreadyOverdueWhenCreated: missing.filter((plan) => backfillDueOn(plan.approvedAt) < today).length,
    });
  } else {
    const exclude = await excluded();
    const report = await withCoreTransaction(async (c) => {
      const generation = await getCurrentGeneration(c);
      const operator = (await c.query<{ id: string }>(
        "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='governance' AND r.active ORDER BY p.email LIMIT 1",
        [generation],
      )).rows[0];
      if (!operator) throw new Error("A governance account is required to record the backfill");
      const missing = await loadMissingCheckins(c, generation, exclude);
      return applyMissingCheckins(c, generation, missing, operator.id, today);
    }, "exclusive");
    await emit({ mode: "applied", schema, excludedStudents: exclude.length, checkinsCreated: report.created, alreadyOverdueWhenCreated: report.alreadyOverdue });
  }
} finally {
  await closePool();
}
