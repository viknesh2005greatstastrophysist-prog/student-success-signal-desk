import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required for migrations");

const migrationFiles = ["001_aura_state.sql", "002_governed_runtime.sql", "003_mentor_gate.sql"];
const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await client.query(sql);
    process.stdout.write(`Applied ${file}\n`);
  }
} finally {
  await client.end();
}
