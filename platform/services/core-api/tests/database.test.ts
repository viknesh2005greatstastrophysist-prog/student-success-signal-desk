import assert from "node:assert/strict";
import test from "node:test";
import { closePool, getPool } from "../lib/db";
import { migrateCoreDatabase } from "../lib/migrations";
import { readCurrentSeedStats, resetSyntheticSeed } from "../lib/reset";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

test("isolated Core schema migrates to exactly 34 domain tables and resets serially", { skip: !runDatabaseTests }, async () => {
  assert.notEqual(process.env.CORE_DATABASE_SCHEMA, "aura_core", "Database tests must not target the deployed Core schema");
  assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test/);

  await migrateCoreDatabase();
  const confirmation = "AURA-SYNTHETIC-SEED-V1";
  const manifests = await Promise.all([
    resetSyntheticSeed(confirmation, "database-test-a"),
    resetSyntheticSeed(confirmation, "database-test-b"),
  ]);
  assert.notEqual(manifests[0].generationId, manifests[1].generationId);

  const stats = await readCurrentSeedStats();
  assert.equal(stats.departments, 2);
  assert.equal(stats.student_profiles, 12);
  assert.equal(stats.courses, 6);
  assert.equal(stats.course_offerings, 6);
  assert.equal(stats["role:student"], 12);
  assert.equal(stats["role:parent"], 9);
  assert.equal(stats["role:faculty"], 4);
  assert.equal(stats["role:hod"], 2);
  assert.equal(stats["role:governance"], 1);

  const pool = getPool();
  const schema = process.env.CORE_DATABASE_SCHEMA!;
  const tableCount = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'",
    [schema],
  );
  assert.equal(Number(tableCount.rows[0]?.count), 34);

  const completedResets = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".simulation_resets WHERE completed_at IS NOT NULL`,
  );
  assert.ok(Number(completedResets.rows[0]?.count) >= 2);

  const triggerCount = await pool.query<{ count: string }>(
    "SELECT count(DISTINCT trigger_name)::text AS count FROM information_schema.triggers WHERE trigger_schema = $1 AND trigger_name LIKE '%_append_only'",
    [schema],
  );
  assert.equal(Number(triggerCount.rows[0]?.count), 8);
});

test.after(async () => {
  await closePool();
});
