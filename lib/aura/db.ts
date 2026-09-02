import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

declare global {
  var auraPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const nextPool = new Pool({ connectionString, max: 4, idleTimeoutMillis: 5_000 });
  attachDatabasePool(nextPool);
  return nextPool;
}

export const pool = globalThis.auraPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.auraPool = pool;
