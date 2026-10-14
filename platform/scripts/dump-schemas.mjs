/**
 * Logical backup of whole Postgres schemas, written without pg_dump (the machine has no
 * Postgres client tools). Produces one restorable SQL file and a manifest of row counts and
 * row-content hashes per table, so a backup can be checked against the live schema.
 *
 *   node scripts/dump-schemas.mjs <environment.json> <output-folder> <tag> <schema> [<schema> ...]
 *
 * The environment file is read in this process only; no connection detail is printed.
 * Restore: run the SQL file with psql; data loads through jsonb_populate_recordset, so
 * column types round-trip. Foreign keys, indexes and triggers are created after the data.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const [envFile, outDir, tag, ...schemas] = process.argv.slice(2);
if (!envFile || !outDir || !tag || !schemas.length) throw new Error("Usage: dump-schemas.mjs <environment.json> <output-folder> <tag> <schema>...");
const require = createRequire(new URL("../services/core-api/package.json", import.meta.url));
const pg = require("pg");
const env = JSON.parse(await readFile(envFile, "utf8"));
const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
const local = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();
await client.query("SET statement_timeout = 0");
const id = (s) => `"${String(s).replaceAll('"', '""')}"`;
const lines = [];
const manifest = { tag, takenAt: new Date().toISOString(), schemas: {} };
await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
for (const schema of schemas) {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Unexpected schema name");
  lines.push(`-- schema ${schema}`, `CREATE SCHEMA IF NOT EXISTS ${id(schema)};`);
  const fns = (await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind='f' ORDER BY p.proname`, [schema])).rows;
  for (const f of fns) lines.push(`${f.def};`);
  const seqs = (await client.query(
    `SELECT c.relname, s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname=$1 AND c.relkind='S'`, [schema])).rows;
  for (const s of seqs) lines.push(`CREATE SEQUENCE IF NOT EXISTS ${id(schema)}.${id(s.relname)} START ${s.seqstart} INCREMENT ${s.seqincrement} MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} CACHE ${s.seqcache}${s.seqcycle ? " CYCLE" : ""};`);
  const tables = (await client.query(
    `SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`, [schema])).rows;
  manifest.schemas[schema] = { tables: {} };
  const later = [];
  for (const t of tables) {
    const cols = (await client.query(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS def, a.attgenerated, a.attidentity
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid])).rows;
    if (cols.some((c) => c.attgenerated || c.attidentity)) throw new Error(`Generated or identity columns in ${t.relname} are not supported`);
    lines.push(`CREATE TABLE ${id(schema)}.${id(t.relname)} (\n  ${cols.map((c) => `${id(c.attname)} ${c.type}${c.def ? ` DEFAULT ${c.def.replaceAll(`${schema}.`, `${id(schema)}.`)}` : ""}${c.attnotnull ? " NOT NULL" : ""}`).join(",\n  ")}\n);`);
    const cons = (await client.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=$1 ORDER BY contype='f', conname`, [t.oid])).rows;
    for (const k of cons) {
      const stmt = `ALTER TABLE ${id(schema)}.${id(t.relname)} ADD CONSTRAINT ${id(k.conname)} ${k.def};`;
      (k.contype === "f" ? later : lines).push(stmt);
    }
    const idx = (await client.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid=$3) ORDER BY indexname`, [schema, t.relname, t.oid])).rows;
    for (const i of idx) later.push(`${i.indexdef};`);
    const trg = (await client.query(`SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid=$1 AND NOT tgisinternal ORDER BY tgname`, [t.oid])).rows;
    for (const g of trg) later.push(`${g.def};`);
    const q = `${id(schema)}.${id(t.relname)}`;
    const count = Number((await client.query(`SELECT count(*) AS n FROM ${q}`)).rows[0].n);
    const hash = (await client.query(`SELECT coalesce(md5(string_agg(x, E'\\n' ORDER BY x)),'') AS h FROM (SELECT t::text AS x FROM ${q} t) s`)).rows[0].h;
    manifest.schemas[schema].tables[t.relname] = { rows: count, md5: hash };
    for (let offset = 0; offset < count; offset += 500) {
      const rows = (await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS j FROM (SELECT * FROM ${q} ORDER BY ctid LIMIT 500 OFFSET ${offset}) t`)).rows[0].j;
      const tagStr = `d${createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 10)}`;
      lines.push(`INSERT INTO ${q} SELECT * FROM jsonb_populate_recordset(NULL::${q}, $${tagStr}$${JSON.stringify(rows)}$${tagStr}$::jsonb);`);
    }
  }
  lines.push(...later);
  for (const s of seqs) {
    const last = (await client.query(`SELECT last_value, is_called FROM ${id(schema)}.${id(s.relname)}`)).rows[0];
    lines.push(`SELECT setval('${id(schema)}.${id(s.relname)}', ${last.last_value}, ${last.is_called});`);
  }
}
await client.query("ROLLBACK");
await client.end();
await mkdir(outDir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const base = `${outDir}/${tag}-${stamp}`;
await writeFile(`${base}.sql`, lines.join("\n") + "\n", { mode: 0o600 });
await writeFile(`${base}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
const tableCount = Object.values(manifest.schemas).reduce((n, s) => n + Object.keys(s.tables).length, 0);
const rowCount = Object.values(manifest.schemas).reduce((n, s) => n + Object.values(s.tables).reduce((m, t) => m + t.rows, 0), 0);
console.log(JSON.stringify({ file: `${base}.sql`, manifest: `${base}.manifest.json`, schemas, tables: tableCount, rows: rowCount }));
