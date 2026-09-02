import { Pool, type PoolClient } from "pg";
import { loadCoreConfig, quoteIdentifier } from "./config";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const config = loadCoreConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function withCoreTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  mode: "shared" | "exclusive" = "shared",
): Promise<T> {
  const client = await getPool().connect();
  const schema = quoteIdentifier(loadCoreConfig().databaseSchema);
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query(mode === "exclusive" ? "SELECT pg_advisory_xact_lock($1)" : "SELECT pg_advisory_xact_lock_shared($1)", [
      420042,
    ]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
