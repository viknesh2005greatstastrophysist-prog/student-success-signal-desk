/** Additive release migration with before/after preservation checks. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { migrateCoreDatabase } from "../services/core-api/lib/migrations.ts";
import { withCoreTransaction, closePool } from "../services/core-api/lib/db.ts";
const allowed = ["aura_project_core", "aura_hosted_project_core"];
assert.ok(allowed.includes(process.env.CORE_DATABASE_SCHEMA ?? ""));
const tables = [
  "people",
  "student_profiles",
  "attendance_records",
  "marks",
  "faculty_decisions",
  "support_plans",
  "domain_events",
  "ch11_events",
  "ch11_jobs",
];
async function snapshot() {
  return withCoreTransaction(async (c) => {
    const counts: Record<string, number> = {};
    for (const table of tables)
      counts[table] = (
        await c.query(`SELECT count(*)::int AS n FROM ${table}`)
      ).rows[0].n;
    const dataset = (
      await c.query(
        "SELECT dataset_hash,md5(review::text) AS stored_review_hash FROM project_dataset ORDER BY id",
      )
    ).rows;
    // Students whose latest case is still awaiting a mentor decision, chosen by
    // status rather than by register number. Their state must survive the migration.
    const pending = (
      await c.query(
        `SELECT s.id,
          (SELECT count(*)::int FROM support_plans p WHERE p.student_id=s.id) AS publications,
          (SELECT count(*)::int FROM faculty_decisions d JOIN support_cases sc ON sc.id=d.support_case_id WHERE sc.student_id=s.id) AS decisions,
          (SELECT count(*)::int FROM faculty_decisions d JOIN support_cases sc ON sc.id=d.support_case_id WHERE sc.student_id=s.id AND d.decision='approved') AS approvals,
          (SELECT count(*)::int FROM support_cases sc WHERE sc.student_id=s.id AND sc.status='awaiting_faculty') AS pending_cases,
          (SELECT sc.status FROM support_cases sc WHERE sc.student_id=s.id ORDER BY sc.opened_at DESC,sc.id DESC LIMIT 1) AS latest_case_status,
          (SELECT count(*)::int FROM faculty_decisions d WHERE d.support_case_id=(SELECT sc.id FROM support_cases sc WHERE sc.student_id=s.id ORDER BY sc.opened_at DESC,sc.id DESC LIMIT 1)) AS latest_case_decisions
         FROM student_profiles s
         WHERE (SELECT sc.status FROM support_cases sc WHERE sc.student_id=s.id ORDER BY sc.opened_at DESC,sc.id DESC LIMIT 1)='awaiting_faculty'
         ORDER BY s.id`,
      )
    ).rows;
    assert.ok(pending.length > 0, "no student with a pending case to preserve");
    for (const row of pending) {
      assert.ok(row.pending_cases > 0);
      assert.equal(row.latest_case_decisions, 0);
    }
    assert.equal(counts.student_profiles, 321);
    assert.equal(counts.people, 647);
    return { counts, dataset, pendingStudents: pending };
  });
}
try {
  const before = await snapshot();
  await migrateCoreDatabase();
  const after = await snapshot();
  assert.deepEqual(after, before);
  await writeFile(
    `../runtime/streamlit-project/chapter11-${process.env.CORE_DATABASE_SCHEMA}-preservation.json`,
    JSON.stringify(
      {
        status: "passed",
        before,
        after,
        additiveMigration: true,
        realMentorSignoff: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      schema: process.env.CORE_DATABASE_SCHEMA,
      students: 321,
      accounts: 647,
      allExistingCountsUnchanged: true,
      datasetHashUnchanged: true,
      pendingCasesPreserved: true,
    }),
  );
} finally {
  await closePool();
}
