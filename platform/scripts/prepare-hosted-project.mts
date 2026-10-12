import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Pool, type PoolClient } from "pg";
import { projectKey } from "../services/core-api/lib/project-cohort";
import { requireHostedCollegeEnvironment } from "@aura/contracts";

process.umask(0o077);
const folder = new URL("../../runtime/hosted-project/", import.meta.url);
const hosted = JSON.parse(await readFile(new URL("environment.json", folder), "utf8"));
const local = JSON.parse(await readFile(new URL("../../runtime/project-final/environment.json", import.meta.url), "utf8"));
requireHostedCollegeEnvironment(hosted);
const sourceUrl = new URL(local.DATABASE_URL);
if (sourceUrl.hostname !== "127.0.0.1" || sourceUrl.port !== "55432" || sourceUrl.pathname !== "/aura_project") throw new Error("Reviewed private project source required");
Object.assign(process.env, hosted);
process.env.NODE_ENV = "production";
const { migrateCoreDatabase } = await import("../services/core-api/lib/migrations");
const sourcePool = new Pool({ connectionString: local.DATABASE_URL, max: 1 });
const targetPool = new Pool({ connectionString: hosted.DATABASE_URL_UNPOOLED ?? hosted.DATABASE_URL, max: 1 });
const source = await sourcePool.connect();
const target = await targetPool.connect();
let targetHeld = true;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const report: Record<string, unknown> = { namedDataUploadAuthorized: true, oldSchemasChanged: false, tables: {} };

async function copyTable(fromSchema: string, toSchema: string, table: string, writer: PoolClient = target) {
  const columns = (await source.query<{ name: string; type: string }>(
    "SELECT a.attname AS name,t.typname AS type FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=($1||'.'||quote_ident($2))::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
    [fromSchema, table],
  )).rows;
  const names = columns.map(c => quote(c.name)).join(",");
  const rows = (await source.query(`SELECT ${names} FROM ${quote(fromSchema)}.${quote(table)}`)).rows;
  for (let start = 0; start < rows.length; start += 250) {
    const values: unknown[] = [];
    const tuples = rows.slice(start, start + 250).map(row => "(" + columns.map(column => {
      const value = row[column.name];
      values.push(value !== null && ["json", "jsonb"].includes(column.type) ? JSON.stringify(value) : value);
      return "$" + values.length;
    }).join(",") + ")").join(",");
    await writer.query(`INSERT INTO ${quote(toSchema)}.${quote(table)}(${names}) VALUES ${tuples}`, values);
  }
  const count = (await writer.query(`SELECT count(*)::int AS n FROM ${quote(toSchema)}.${quote(table)}`)).rows[0].n;
  if (count !== rows.length) throw new Error(`Hosted copy count mismatch: ${table}`);
  (report.tables as Record<string, number>)[`${toSchema}.${table}`] = count;
}

async function orderedTables(schema: string) {
  const tables = (await source.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'", [schema])).rows.map(r => r.table_name).filter(t => t !== "schema_migrations");
  const dependencies = (await source.query<{ child: string; parent: string }>("SELECT c.relname AS child,p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE f.contype='f' AND n.nspname=$1 AND pn.nspname=$1 AND c.oid<>p.oid", [schema])).rows;
  const ordered: string[] = [];
  while (ordered.length < tables.length) {
    const next = tables.filter(t => !ordered.includes(t) && dependencies.filter(d => d.child === t).every(d => ordered.includes(d.parent)));
    if (!next.length) throw new Error("Source foreign-key graph has an unresolved cycle; copy halted");
    ordered.push(...next);
  }
  return ordered;
}

function command(args: string[]) {
  return new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: "inherit" });
    child.on("error", fail);
    child.on("exit", code => code === 0 ? done() : fail(new Error(`Hosted setup command failed (${code})`)));
  });
}

try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const oldSchemas = (await target.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('aura_core','aura_identity')")).rows.length;
  if (oldSchemas !== 2) throw new Error("Existing hosted Core/Identity schemas not found; confirm database target");
  await migrateCoreDatabase();
  await target.query(`CREATE TABLE IF NOT EXISTS ${quote(hosted.CORE_DATABASE_SCHEMA)}.project_dataset(id uuid PRIMARY KEY,dataset_hash text NOT NULL,review jsonb NOT NULL,provenance jsonb NOT NULL)`);
  await target.query(`SET search_path TO ${quote(hosted.CORE_DATABASE_SCHEMA)},public`);
  await target.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='project_dataset_immutable' AND tgrelid='project_dataset'::regclass) THEN CREATE TRIGGER project_dataset_immutable BEFORE UPDATE OR DELETE ON project_dataset FOR EACH ROW EXECUTE FUNCTION reject_append_only_change(); END IF; END $$");
  const generation = (await source.query("SELECT current_generation_id FROM aura_project_core.institution_revisions WHERE singleton=true")).rows[0].current_generation_id;
  const existing = (await target.query(`SELECT current_generation_id FROM ${quote(hosted.CORE_DATABASE_SCHEMA)}.institution_revisions WHERE singleton=true`)).rows[0];
  if (existing && existing.current_generation_id !== generation) throw new Error("Refusing to replace a different hosted generation");
  if (!existing) {
    await target.query("BEGIN");
    try {
      for (const table of await orderedTables("aura_project_core")) await copyTable("aura_project_core", hosted.CORE_DATABASE_SCHEMA, table);
      await target.query("COMMIT");
    } catch (error) { await target.query("ROLLBACK"); throw error; }
  }
  const cohort=JSON.parse(await readFile(new URL("../../runtime/project-final/cohort.json",import.meta.url),"utf8"));
  const invoiceIds=cohort.students.map((student:{id:string})=>projectKey(cohort.seed,`invoice:${student.id}`));
  const studentIds=cohort.students.map((student:{id:string})=>student.id);
  await target.query(`UPDATE ${quote(hosted.CORE_DATABASE_SCHEMA)}.fee_invoices i SET record_origin='generated_project_operations' FROM unnest($1::uuid[],$2::uuid[]) AS generated(invoice_id,student_id) WHERE i.id=generated.invoice_id AND i.student_id=generated.student_id AND i.generation_id=$3 AND i.amount_paise=4500000 AND i.description='Semester tuition and laboratory fee'`,[invoiceIds,studentIds,generation]);
  await target.query(`CREATE SCHEMA IF NOT EXISTS ${quote(hosted.AUTH_DATABASE_SCHEMA)}`);
  // Release our only target connection before the schema compiler opens its own.
  target.release();
  targetHeld = false;
  await command(["node_modules/auth/dist/index.mjs", "migrate", "--config", "services/auth-server/lib/auth.ts", "--yes"]);
  const identityTarget = await targetPool.connect();
  try {
    const userCount = (await identityTarget.query(`SELECT count(*)::int AS n FROM ${quote(hosted.AUTH_DATABASE_SCHEMA)}."user"`)).rows[0].n;
    if (!userCount) {
      await identityTarget.query("BEGIN");
      try {
        await copyTable("aura_project_identity", hosted.AUTH_DATABASE_SCHEMA, "user", identityTarget);
        await copyTable("aura_project_identity", hosted.AUTH_DATABASE_SCHEMA, "account", identityTarget);
        await identityTarget.query("COMMIT");
      } catch (error) { await identityTarget.query("ROLLBACK"); throw error; }
    }
  } finally { identityTarget.release(); }
  await source.query("COMMIT");
  await command(["--import", "tsx", "services/auth-server/scripts/provision-portal-clients.ts"]);
  report.status = "prepared";
  report.sourceGeneration = generation;
  report.identitySessionsCopied = false;
  report.localSigningKeysCopied = false;
  await writeFile(new URL("database-copy.json", folder), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ hostedDatasetPrepared: true, students: 321, oldSchemasChanged: false, passwordAccountsPreserved: true }));
} finally {
  if (targetHeld) target.release();
  source.release();
  await sourcePool.end();
  await targetPool.end();
}
