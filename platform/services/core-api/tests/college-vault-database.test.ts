import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadCoreConfig, quoteIdentifier } from "../lib/config";
import { digest } from "../lib/chapter11/engine";

test("private vault persists immutable source/access versions in an isolated disposable PostgreSQL schema", { skip: process.env.RUN_COLLEGE_VAULT_DB_TESTS !== "1" }, async () => {
  const config = loadCoreConfig(), schema = config.databaseSchema;
  if (!schema.startsWith("aura_college_test_")) throw new Error("Use a new disposable aura_college_test_* schema");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 }); const client = await pool.connect(); let created = false;
  try {
    const existing = await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1", [schema]);
    if (existing.rowCount) throw new Error("Test schema already exists; choose a fresh name");
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`); created = true;
    await client.query(`SET search_path TO ${quoteIdentifier(schema)},public`);
    await client.query(await readFile(new URL("../migrations/college/001_private_vault.sql", import.meta.url), "utf8"));
    const review = { fictional: true, rawValue: 0, reportingPeriod: null }, access = { fictional: true, humanAttestation: "TEST ONLY" };
    const datasetHash = digest(review), packageHash = digest({ review, access });
    await client.query("INSERT INTO college_source_vault(package_hash,dataset_hash,payload_hash,review,access) VALUES($1,$2,$1,$3::jsonb,$4::jsonb)", [packageHash, datasetHash, JSON.stringify(review), JSON.stringify(access)]);
    const saved = (await client.query("SELECT * FROM college_source_vault WHERE package_hash=$1", [packageHash])).rows[0];
    assert.deepEqual(saved.review, review); assert.equal(digest({ review: saved.review, access: saved.access }), packageHash);
    await assert.rejects(client.query("UPDATE college_source_vault SET access='{}'::jsonb"), /immutable/);
    await assert.rejects(client.query("DELETE FROM college_source_vault"), /immutable/);
    const updatedAccess = { ...access, humanAttestation: "SECOND TEST VERSION" }, secondHash = digest({ review, access: updatedAccess });
    await client.query("INSERT INTO college_source_vault(package_hash,dataset_hash,payload_hash,review,access) VALUES($1,$2,$1,$3::jsonb,$4::jsonb)", [secondHash, datasetHash, JSON.stringify(review), JSON.stringify(updatedAccess)]);
    assert.equal(Number((await client.query("SELECT count(*) FROM college_source_vault")).rows[0].count), 2);
    await client.query("INSERT INTO college_normalization_vault(batch_hash,package_hash,batch) VALUES($1,$2,$3::jsonb)", ["b".repeat(64), packageHash, JSON.stringify({ fictional: true, unknowns: null })]);
    await assert.rejects(client.query("DELETE FROM college_normalization_vault"), /immutable/);
  } finally { if (created) await client.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`); client.release(); await pool.end(); }
});
