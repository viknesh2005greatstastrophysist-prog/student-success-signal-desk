import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadCoreConfig, quoteIdentifier } from "./config";

const migrations = [
  { id: "001_core", url: new URL("../migrations/001_core.sql", import.meta.url) },
  { id: "002_parent_grant_revision", url: new URL("../migrations/002_parent_grant_revision.sql", import.meta.url) },
  { id: "003_replay_idempotency", url: new URL("../migrations/003_replay_idempotency.sql", import.meta.url) },
];

export async function migrateCoreDatabase(): Promise<void> {
  const config = loadCoreConfig();
  const schema = quoteIdentifier(config.databaseSchema);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query("SELECT pg_advisory_xact_lock($1)", [420041]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const sql = await readFile(migration.url, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE id = $1", [
        migration.id,
      ]);

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Migration ${migration.id} changed after it was applied`);
        }
        continue;
      }

      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [migration.id, checksum]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
