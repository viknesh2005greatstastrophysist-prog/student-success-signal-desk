/** Private-runtime acceptance; no passwords, tokens or record identities in output. */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import pg from "pg";
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = JSON.parse(
  fs.readFileSync(root + "runtime/project-final/environment.json"),
);
const accounts = JSON.parse(
  fs.readFileSync(root + "runtime/project-final/accounts.json"),
);
const account =
  accounts.find((a) => a.role === "student" && a.email.includes("051")) ??
  accounts.filter((a) => a.role === "student")[50];
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const auth = '"' + env.AUTH_DATABASE_SCHEMA + '"',
  core = '"' + env.CORE_DATABASE_SCHEMA + '"';
const worker = spawn(process.execPath, [root + "streamlit_app/engine.mjs"], {
  env: { ...process.env, ...env, NODE_ENV: "production" },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
const digest = (t) => createHash("sha256").update(t).digest("hex");
const checks = [];
let token, personId;
async function rpc(action, payload = {}, t = token) {
  const id = randomUUID();
  worker.stdin.write(
    JSON.stringify({ id, action, payload, ...(t ? { token: t } : {}) }) + "\n",
  );
  const row = await lines.next();
  assert(!row.done, "Worker stopped");
  const r = JSON.parse(row.value);
  assert.equal(r.id, id);
  return r;
}
async function login(source = "auth-acceptance") {
  const r = await rpc(
    "login",
    {
      email: account.email,
      password: account.password,
      portal: "student",
      source,
    },
    null,
  );
  assert(r.ok, JSON.stringify(r.error));
  token = r.data.token;
  personId = r.data.actor.personId;
  return r;
}
async function denial(action, payload = {}, status = 401, t = token) {
  const r = await rpc(action, payload, t);
  assert.equal(r.ok, false);
  assert.equal(r.error.status, status);
}
try {
  await denial("overview", {}, 401, null);
  checks.push("anonymous denied");
  const wrong = await rpc(
    "login",
    {
      email: account.email,
      password: account.password,
      portal: "faculty",
      source: "auth-acceptance",
    },
    null,
  );
  assert.equal(wrong.error.status, 403);
  checks.push("wrong workspace denied");
  await login();
  const stored = await db.query(
    `SELECT token_hash FROM ${auth}.streamlit_sessions WHERE token_hash=$1`,
    [digest(token)],
  );
  assert.equal(stored.rowCount, 1);
  assert.notEqual(stored.rows[0].token_hash, token);
  checks.push("opaque token stored only as hash");
  await db.query(
    `UPDATE ${auth}.streamlit_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`,
    [digest(token)],
  );
  await denial("overview");
  await rpc("logout");
  checks.push("expired session denied");
  await login();
  await db.query(
    `DELETE FROM ${auth}.session WHERE id IN(SELECT auth_session_id FROM ${auth}.streamlit_sessions WHERE token_hash=$1)`,
    [digest(token)],
  );
  await denial("overview");
  await rpc("logout");
  checks.push("identity session revocation enforced");
  await login();
  await db.query(
    `UPDATE ${auth}.streamlit_sessions SET credential_hash='stale' WHERE token_hash=$1`,
    [digest(token)],
  );
  await denial("overview");
  await rpc("logout");
  checks.push("changed credential fingerprint invalidates session");
  await login();
  await db.query(
    `UPDATE ${core}.role_assignments SET active=false WHERE person_id=$1`,
    [personId],
  );
  await denial("overview");
  assert((await rpc("logout")).ok);
  assert.equal(
    (
      await db.query(
        `SELECT 1 FROM ${auth}.streamlit_sessions WHERE token_hash=$1`,
        [digest(token)],
      )
    ).rowCount,
    0,
  );
  checks.push("role revoked immediately and logout still removes session");
  await db.query(
    `UPDATE ${core}.role_assignments SET active=true WHERE person_id=$1`,
    [personId],
  );
  token = null;
  const email = `auth-check-${randomUUID()}@example.invalid`;
  for (let i = 0; i < 11; i++) {
    const r = await rpc(
      "login",
      {
        email,
        password: "wrong",
        portal: "student",
        source: "isolated-auth-check",
      },
      null,
    );
    assert.equal(r.error.status, i < 10 ? 401 : 429);
  }
  assert.equal(
    (
      await rpc(
        "login",
        {
          email,
          password: "wrong",
          portal: "student",
          source: "other-auth-check",
        },
        null,
      )
    ).error.status,
    401,
  );
  checks.push("attempt limiting is per source and account");
  const old = digest(randomUUID());
  await db.query(
    `INSERT INTO ${auth}.streamlit_login_attempts VALUES($1,now()-interval '1 day',1)`,
    [old],
  );
  await rpc(
    "login",
    {
      email,
      password: "wrong",
      portal: "student",
      source: "cleanup-auth-check",
    },
    null,
  );
  assert.equal(
    (
      await db.query(
        `SELECT 1 FROM ${auth}.streamlit_login_attempts WHERE email_hash=$1`,
        [old],
      )
    ).rowCount,
    0,
  );
  checks.push("expired attempt buckets cleaned during operation");
  const result = { status: "passed", checks };
  fs.writeFileSync(
    root + "runtime/streamlit-project/auth-acceptance.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "passed", checks: checks.length }));
} finally {
  if (personId)
    await db.query(
      `UPDATE ${core}.role_assignments SET active=true WHERE person_id=$1`,
      [personId],
    );
  if (token) await rpc("logout");
  worker.stdin.end();
  worker.kill();
  await db.end();
}
