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
    pool.on("error", () => {
      console.error(
        "An idle database connection closed; the pool will replace it.",
      );
    });
  }
  return pool;
}

/** Roll back after a failure without letting a throwing ROLLBACK mask the original
 * error. Returns the rollback error (if any) so the caller can release the client
 * with the error flag and have the pool discard the connection. */
export async function rollbackQuietly(
  client: { query(sql: string): Promise<unknown> },
): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (rollbackError) {
    return rollbackError instanceof Error
      ? rollbackError
      : new Error("ROLLBACK failed");
  }
}

/** Per-reader statement timeout (ms) for snapshot capture; CH11_READER_TIMEOUT_MS
 * overrides the 20 s default. Always a validated integer, so it is safe to inline. */
export function readerTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.CH11_READER_TIMEOUT_MS);
  return Number.isInteger(raw) && raw >= 1 && raw <= 600_000 ? raw : 20_000;
}

export async function withCoreTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  mode: "shared" | "exclusive" = "shared",
): Promise<T> {
  const nested = snapshotClient.getStore();
  if (nested) {
    if (mode === "exclusive")
      throw new Error("Exclusive operations cannot run inside source capture");
    return work(nested);
  }
  const client = await getPool().connect();
  const schema = quoteIdentifier(loadCoreConfig().databaseSchema);
  let discard: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${schema}, public`);
    await client.query(
      mode === "exclusive"
        ? "SELECT pg_advisory_xact_lock($1)"
        : "SELECT pg_advisory_xact_lock_shared($1)",
      [420042],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    discard = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(discard);
  }
}

/** Nested read collectors share a short transaction, avoiding pool starvation
 * while holding the institution revision lock. Model work happens afterwards. */
export async function withCoreSnapshot<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withCoreTransaction((client) =>
    snapshotClient.run(client, () => work(client)),
  );
}

export async function closePool(): Promise<void> {
  if (sourcePool) {
    await sourcePool.end();
    sourcePool = undefined;
  }
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

let sourcePool: Pool | undefined;
let captureTail: Promise<void> = Promise.resolve();
/** Four independent read connections import one exported MVCC snapshot. A capture
 * gate bounds source connections and prevents concurrent jobs starving exporters. */
export async function collectSnapshot<T>(
  readers: Array<() => Promise<T>>,
  concurrency = 4,
) {
  const previous = captureTail;
  let unlock!: () => void;
  captureTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  let exporter: PoolClient | undefined;
  let lockHeld = false;
  let discard: Error | undefined;
  const timeoutMs = readerTimeoutMs();
  try {
    const schema = quoteIdentifier(loadCoreConfig().databaseSchema);
    exporter = await getPool().connect();
    // Take the shared lock before BEGIN: a REPEATABLE READ snapshot is fixed by the
    // first statement of the transaction, so locking inside it would read a
    // revision older than the exclusive operation that was holding the lock.
    await exporter.query("SELECT pg_advisory_lock_shared($1)", [420042]);
    lockHeld = true;
    await exporter.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await exporter.query(`SET LOCAL search_path TO ${schema}, public`);
    await exporter.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const revision = (
      await exporter.query<{ revision: string }>(
        "SELECT revision::text FROM institution_revisions WHERE singleton=true FOR SHARE",
      )
    ).rows[0]!.revision;
    const snapshot = (
      await exporter.query<{ snapshot: string }>(
        "SELECT pg_export_snapshot() AS snapshot",
      )
    ).rows[0]!.snapshot;
    if (!/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(snapshot))
      throw new Error("Invalid exported snapshot identifier");
    sourcePool ??= new Pool({
      connectionString: loadCoreConfig().databaseUrl,
      max: 4,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
    });
    if (!sourcePool.listeners("error").length)
      sourcePool.on("error", sourcePoolError);
    const results: T[] = [];
    const timings: number[] = [];
    let cursor = 0;
    const settled = await Promise.allSettled(
      Array.from(
        { length: Math.min(concurrency, readers.length) },
        async () => {
          while (cursor < readers.length) {
            const index = cursor++;
            const client = await sourcePool!.connect();
            const started = performance.now();
            let readerDiscard: Error | undefined;
            try {
              await client.query(
                "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
              );
              await client.query(`SET TRANSACTION SNAPSHOT '${snapshot}'`);
              await client.query(`SET LOCAL search_path TO ${schema}, public`);
              await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
              results[index] = await snapshotClient.run(
                client,
                readers[index]!,
              );
              await client.query("COMMIT");
              timings[index] = performance.now() - started;
            } catch (error) {
              readerDiscard = await rollbackQuietly(client);
              throw error;
            } finally {
              client.release(readerDiscard);
            }
          }
        },
      ),
    );
    const failure = settled.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await exporter.query("COMMIT");
    return {
      results,
      timings,
      evidenceRevision: revision,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (exporter) discard = await rollbackQuietly(exporter);
    throw error;
  } finally {
    if (exporter && lockHeld) {
      try {
        const released = await exporter.query<{ ok: boolean }>(
          "SELECT pg_advisory_unlock_shared($1) AS ok",
          [420042],
        );
        // A lock that could not be released must not return to the pool.
        if (!released.rows[0]?.ok)
          discard ??= new Error("Shared advisory lock was not released");
      } catch (unlockError) {
        discard ??=
          unlockError instanceof Error
            ? unlockError
            : new Error("Advisory unlock failed");
      }
    }
    exporter?.release(discard);
    unlock();
  }
}
function sourcePoolError() {
  console.error("A source reader closed; the pool will replace it.");
}
