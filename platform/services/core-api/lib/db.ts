import { Pool, type PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { loadCoreConfig, quoteIdentifier } from "./config";

let pool: Pool | undefined;
const snapshotClient = new AsyncLocalStorage<PoolClient>();

export function getPool(): Pool {
  if (!pool) {
    const config = loadCoreConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", () => { console.error("An idle database connection closed; the pool will replace it."); });
  }
  return pool;
}

export async function withCoreTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  mode: "shared" | "exclusive" = "shared",
): Promise<T> {
  const nested=snapshotClient.getStore();
  if(nested){if(mode==="exclusive")throw new Error("Exclusive operations cannot run inside source capture");return work(nested);}
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

/** Nested read collectors share a short transaction, avoiding pool starvation
 * while holding the institution revision lock. Model work happens afterwards. */
export async function withCoreSnapshot<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  return withCoreTransaction(client=>snapshotClient.run(client,()=>work(client)));
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
