import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import pg from "pg";

const platform = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = process.env.CORE_DATABASE_SCHEMA ?? "";
const identity = process.env.AUTH_DATABASE_SCHEMA ?? "";
for (const [schema, pattern] of [[core, /^aura_core_(local|test_[a-z0-9_]+)$/], [identity, /^aura_identity_(local|test_[a-z0-9_]+)$/]]) {
  if (!pattern.test(schema)) throw new Error("Local initialization requires separate aura_core_local/aura_identity_local or aura_*_test_* schemas");
}
if (process.env.AURA_CLIENT_PROFILE !== "local") throw new Error("Set AURA_CLIENT_PROFILE=local for local initialization");
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) throw new Error("Configure PostgreSQL in the private environment first");
const run = args => execFileSync(process.execPath, args, { cwd: platform, env: process.env, stdio: "inherit" });
const tsx = "node_modules/tsx/dist/cli.mjs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
try {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${identity}"`);
  run([tsx, "services/core-api/scripts/migrate.ts"]);
  const state = await pool.query(`SELECT current_generation_id FROM "${core}".institution_revisions WHERE singleton=true`);
  if (!state.rows[0]?.current_generation_id) run([tsx, "services/core-api/scripts/reset-seed.ts"]);
  else console.log("Existing local institutional generation preserved.");
  run(["node_modules/auth/dist/index.mjs", "migrate", "--config", "services/auth-server/lib/auth.ts", "--yes"]);
  run([tsx, "services/auth-server/scripts/provision-portal-clients.ts"]);
  run([tsx, "services/auth-server/scripts/seed-demo-identities.ts"]);
  console.log("Local identity, public PKCE clients and synthetic Core are linked.");
} finally { await pool.end(); }
