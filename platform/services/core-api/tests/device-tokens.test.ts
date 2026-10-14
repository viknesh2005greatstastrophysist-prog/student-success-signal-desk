import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCoreConfig, quoteIdentifier } from "../lib/config";
import { getCurrentGeneration } from "../lib/command-ledger";
import { closePool, getPool, withCoreTransaction } from "../lib/db";
import {
  DEVICE_TOKENS_DDL,
  DEVICE_TOKEN_TTL_DAYS,
  findDeviceTokens,
  hashDeviceToken,
  isDeviceTokenShape,
  issueDeviceToken,
  purgeDeviceTokens,
  redeemDeviceToken,
  revokeDeviceTokens,
} from "../lib/device-tokens";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";

const squash = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/ ?; ?/g, ";")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();

test("the statements the Streamlit engine applies at start-up are the Core migration 012", async () => {
  const file = await readFile(new URL("../migrations/012_device_tokens.sql", import.meta.url), "utf8");
  assert.equal(squash(DEVICE_TOKENS_DDL.join(";") + ";"), squash(file));
  assert.ok(!/DROP|DELETE|TRUNCATE|ALTER/i.test(file), "additive only");
});

test("device token shape is 32 random bytes as base64url", () => {
  assert.equal(isDeviceTokenShape("A".repeat(43)), true);
  for (const bad of ["", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "/", 7, null])
    assert.equal(isDeviceTokenShape(bad), false);
  assert.equal(hashDeviceToken("x"), createHash("sha256").update("x").digest("hex"));
});

// Opt-in: needs a disposable schema (aura_core_test_device*) on a reachable PostgreSQL;
// never point it at a project or deployed schema.
test(
  "remembered devices: issue, redeem and rotate, expire, revoke, hashed at rest, workspace and credential binding",
  { skip: process.env.RUN_DEVICE_TOKEN_DB_TESTS !== "1", timeout: 120000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_device/);
    const schema = quoteIdentifier(loadCoreConfig().databaseSchema);
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "device-token-isolated-test");
      const subjects = await withCoreTransaction(async (c) => {
        const generation = await getCurrentGeneration(c);
        const rows = (
          await c.query<{ subject: string; role: string }>(
            "SELECT p.external_subject AS subject, r.role FROM people p JOIN role_assignments r ON r.generation_id=p.generation_id AND r.person_id=p.id AND r.active WHERE p.generation_id=$1 ORDER BY p.email",
            [generation],
          )
        ).rows;
        const of = (role: string) => rows.find((r) => r.role === role)!.subject;
        return { faculty: of("faculty"), student: of("student") };
      });
      const sql = <T extends object = Record<string, unknown>>(text: string, params: unknown[] = []) =>
        withCoreTransaction(async (c) => (await c.query<T & Record<string, unknown>>(text, params)).rows);
      const credentials = new Map([
        [subjects.faculty, "credential-faculty-v1"],
        [subjects.student, "credential-student-v1"],
      ]);
      const redeem = (token: string, portal: string) =>
        withCoreTransaction((c) =>
          redeemDeviceToken(c, { token, portal, credentialHashFor: async (id) => credentials.get(id) ?? null }),
        );
      const issue = (userId: string, portal: string) =>
        withCoreTransaction((c) => issueDeviceToken(c, { userId, portal, credentialHash: credentials.get(userId)! }));

      // Issue: a random token, valid for 7 days, only its hash is stored.
      const first = await issue(subjects.faculty, "faculty");
      assert.ok(isDeviceTokenShape(first.token));
      const days = (new Date(first.expiresAt).getTime() - Date.now()) / 86_400_000;
      assert.ok(Math.abs(days - DEVICE_TOKEN_TTL_DAYS) < 0.01, `ttl ${days}`);
      const stored = await sql("SELECT * FROM device_tokens WHERE user_id=$1", [subjects.faculty]);
      assert.equal(stored.length, 1);
      assert.equal(stored[0]!.token_hash, hashDeviceToken(first.token));
      assert.ok(!JSON.stringify(stored).includes(first.token), "the token itself is never stored");
      assert.equal(stored[0]!.portal, "faculty");
      assert.equal(stored[0]!.revoked_at, null);

      // Workspace binding: the same token is not found for another workspace.
      assert.deepEqual(await redeem(first.token, "student"), { ok: false, reason: "unknown" });
      assert.deepEqual(await redeem(first.token, "hod"), { ok: false, reason: "unknown" });
      assert.deepEqual(await withCoreTransaction((c) => findDeviceTokens(c, { hod: first.token })), []);

      // Redeem: the actor is bound exactly as a sign-in binds it; the token rotates.
      const used = await redeem(first.token, "faculty");
      assert.ok(used.ok);
      assert.equal(used.actor.role, "faculty");
      assert.equal(used.actor.subject, subjects.faculty);
      assert.ok(used.rotated && isDeviceTokenShape(used.rotated.token) && used.rotated.token !== first.token);
      const rows = await sql("SELECT token_hash,rotated_at,expires_at,replaced_by FROM device_tokens WHERE user_id=$1 ORDER BY created_at", [subjects.faculty]);
      assert.equal(rows.length, 2);
      assert.ok(rows[0]!.rotated_at && rows[0]!.replaced_by);
      assert.ok(new Date(rows[0]!.expires_at as string).getTime() - Date.now() < 125_000, "the old token only lives out the grace period");

      // Grace: a second tab holding the old token still gets in, without a further rotation.
      const grace = await redeem(first.token, "faculty");
      assert.ok(grace.ok && grace.rotated === undefined);
      assert.equal((await sql("SELECT 1 FROM device_tokens WHERE user_id=$1", [subjects.faculty])).length, 2);
      // After the grace period the old token is dead; the new one lives on.
      await sql("UPDATE device_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [hashDeviceToken(first.token)]);
      assert.deepEqual(await redeem(first.token, "faculty"), { ok: false, reason: "unknown" });
      const current = used.rotated!.token;

      // Expiry.
      const short = await issue(subjects.faculty, "lms");
      await sql("UPDATE device_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [hashDeviceToken(short.token)]);
      assert.deepEqual(await redeem(short.token, "lms"), { ok: false, reason: "unknown" });

      // Role and scope are checked again at redemption: a student's token for the
      // department-head workspace is refused and revoked.
      const forged = await issue(subjects.student, "hod");
      const denied = await redeem(forged.token, "hod");
      assert.ok(!denied.ok && denied.reason === "denied" && denied.error?.code === "PORTAL_DENIED");
      assert.equal((await sql("SELECT revoked_at FROM device_tokens WHERE token_hash=$1", [hashDeviceToken(forged.token)]))[0]!.revoked_at !== null, true);
      assert.deepEqual(await redeem(forged.token, "hod"), { ok: false, reason: "unknown" });
      // ... while the same student is let in to the student workspace.
      const student = await issue(subjects.student, "student");
      const studentIn = await redeem(student.token, "student");
      assert.ok(studentIn.ok && studentIn.actor.role === "student" && studentIn.actor.studentId);

      // A changed password (credential) ends the remembered device.
      const stale = await issue(subjects.student, "lms");
      credentials.set(subjects.student, "credential-student-v2");
      const changed = await redeem(stale.token, "lms");
      assert.deepEqual(changed, { ok: false, reason: "credential_changed" });
      assert.deepEqual(await redeem(stale.token, "lms"), { ok: false, reason: "unknown" });
      credentials.set(subjects.student, "credential-student-v1");

      // Revoke (sign-out): every token of this account in this workspace; other workspaces stay.
      const lms = await issue(subjects.faculty, "lms");
      assert.ok((await withCoreTransaction((c) => revokeDeviceTokens(c, { userId: subjects.faculty, portal: "faculty" }))) >= 1);
      assert.deepEqual(await redeem(current, "faculty"), { ok: false, reason: "unknown" });
      assert.ok((await redeem(lms.token, "lms")).ok, "the other workspace is still remembered");

      // find: only live tokens that match their workspace, newest use first.
      const live = await issue(subjects.faculty, "faculty");
      const found = await withCoreTransaction((c) => findDeviceTokens(c, { faculty: live.token, hod: live.token, lms: "B".repeat(43) }));
      assert.deepEqual(found.map((f) => f.portal), ["faculty"]);

      // Housekeeping removes rows a day past expiry or revocation, nothing else.
      await sql("UPDATE device_tokens SET revoked_at=now()-interval '2 days' WHERE token_hash=$1", [hashDeviceToken(current)]);
      const before = (await sql("SELECT 1 FROM device_tokens")).length;
      const purged = await withCoreTransaction((c) => purgeDeviceTokens(c));
      assert.ok(purged >= 1);
      assert.equal((await sql("SELECT 1 FROM device_tokens")).length, before - purged);
      assert.ok((await redeem(live.token, "faculty")).ok);
    } finally {
      if (/^aura_core_test_device/.test(process.env.CORE_DATABASE_SCHEMA ?? "")) {
        await getPool().query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      }
      await closePool();
    }
  },
);
