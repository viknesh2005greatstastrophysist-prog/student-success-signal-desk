import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { withCoreTransaction, closePool } from "../services/core-api/lib/db";
import { loadProjectSources } from "../services/core-api/lib/project-sources";
import { loadCollegeAttendanceReview } from "../services/core-api/lib/chapter11/college-attendance-review";
import { verifyPrivateOriginals } from "../services/core-api/lib/chapter11/college-pilot-sources";
import { collegeDatasetHash } from "../services/core-api/lib/chapter11/college-pilot-engine";
import type { ActorContext } from "@aura/contracts";
import type { ProjectCohort } from "../services/core-api/lib/project-cohort";

process.umask(0o077);
const folder = resolve("../runtime/project-final");
const cohort: ProjectCohort = JSON.parse(await readFile(resolve(folder, "cohort.json"), "utf8"));
const root = resolve("../runtime/college-attendance");
const inputFolder = resolve(root, "2026-10-12");
const review = await loadCollegeAttendanceReview(root, resolve(inputFolder, "attendance.json"));
const originals = await verifyPrivateOriginals(root, inputFolder, review);
assert.equal(collegeDatasetHash(review), cohort.seed);
assert.equal(review.recordedValues, 7265);
const student = cohort.students[0]!;
const actor: ActorContext = { subject: student.parentId, personId: student.parentId, role: "parent", departmentId: cohort.department };
try {
  const before = await loadProjectSources(actor);
  assert.equal(before.students.length, 1);
  const grants = await withCoreTransaction(async c => (await c.query(
    "SELECT g.id,g.granted,g.revision FROM parent_field_grants g JOIN parent_links l ON l.id=g.parent_link_id WHERE l.parent_person_id=$1 AND l.student_id=$2",
    [student.parentId, student.id],
  )).rows);
  try {
    await withCoreTransaction(c => c.query("UPDATE parent_field_grants SET granted=false WHERE id=ANY($1::uuid[])", [grants.map(g => g.id)]));
    const revoked = await loadProjectSources(actor);
    assert.deepEqual(revoked.students, []);
    assert.deepEqual(revoked.sources, []);
  } finally {
    await withCoreTransaction(async c => {
      for (const grant of grants) await c.query("UPDATE parent_field_grants SET granted=$2,revision=$3 WHERE id=$1", [grant.id, grant.granted, grant.revision]);
    });
  }
  assert.deepEqual(await loadProjectSources(actor), before);
  const counts = await withCoreTransaction(async c => {
    await c.query("SAVEPOINT immutable_check");
    let rejected = false;
    try { await c.query("UPDATE project_dataset SET dataset_hash=dataset_hash"); } catch { rejected = true; }
    await c.query("ROLLBACK TO SAVEPOINT immutable_check");
    assert.ok(rejected, "supplied source package is immutable");
    const result: Record<string, number> = {};
    for (const table of ["people", "student_profiles", "parent_links", "mentor_assignments", "registrations", "attendance_records", "marks", "lms_submissions", "fee_invoices"])
      result[table] = (await c.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    return result;
  });
  assert.equal(counts.people, 647);
  assert.equal(counts.attendance_records, 9630);
  await writeFile(resolve(folder, "data-acceptance.json"), JSON.stringify({ status: "passed", originals, datasetHash: cohort.seed, rawValues: review.recordedValues, parentRevocation: "passed and restored", immutableSourceTable: "passed", counts }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ status: "passed", originalSources: originals.sources, rawValues: review.recordedValues, parentRevocation: true, immutableSourceTable: true }));
} finally { await closePool(); }
