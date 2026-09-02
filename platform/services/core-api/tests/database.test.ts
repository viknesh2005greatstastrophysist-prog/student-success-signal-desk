import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ActorContext } from "@aura/contracts";
import { publishAndAssignOffering } from "../lib/commands";
import { closePool, getPool } from "../lib/db";
import { ConflictError } from "../lib/http";
import { migrateCoreDatabase } from "../lib/migrations";
import { registerForOffering, withdrawRegistration } from "../lib/registration-commands";
import { readCurrentSeedStats, resetSyntheticSeed } from "../lib/reset";
import { AuthorizationError } from "../lib/security";

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

  const fixtures = await pool.query<{
    generation_id: string; hod_person_id: string; cse_department_id: string; faculty_person_id: string; cse_offering_id: string; ece_offering_id: string;
    student_person_id: string; student_profile_id: string; student2_person_id: string; student2_profile_id: string; student10_person_id: string; student10_profile_id: string;
  }>(
    `SELECT ir.current_generation_id AS generation_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'hod.cse@aura.invalid') AS hod_person_id,
      (SELECT d.id FROM "${schema}".departments d WHERE d.generation_id = ir.current_generation_id AND d.code = 'CSE') AS cse_department_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'faculty1@aura.invalid') AS faculty_person_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student1@aura.invalid') AS student_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-001') AS student_profile_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student2@aura.invalid') AS student2_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-002') AS student2_profile_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student10@aura.invalid') AS student10_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-010') AS student10_profile_id,
      (SELECT o.id FROM "${schema}".course_offerings o JOIN "${schema}".courses c ON c.id = o.course_id WHERE o.generation_id = ir.current_generation_id AND c.code = 'CS401') AS cse_offering_id,
      (SELECT o.id FROM "${schema}".course_offerings o JOIN "${schema}".courses c ON c.id = o.course_id WHERE o.generation_id = ir.current_generation_id AND c.code = 'EC401') AS ece_offering_id
     FROM "${schema}".institution_revisions ir WHERE ir.singleton = true`,
  );
  const fixture = fixtures.rows[0]!;
  const hod: ActorContext = {
    subject: "database-test-hod",
    role: "hod",
    personId: fixture.hod_person_id,
    departmentId: fixture.cse_department_id,
  };
  const commandId = randomUUID();
  const first = await publishAndAssignOffering(hod, fixture.cse_offering_id, commandId, {
    facultyPersonId: fixture.faculty_person_id,
    expectedRevision: 0,
  });
  const duplicate = await publishAndAssignOffering(hod, fixture.cse_offering_id, commandId, {
    facultyPersonId: fixture.faculty_person_id,
    expectedRevision: 0,
  });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.receipt, first.receipt);
  await assert.rejects(
    publishAndAssignOffering(hod, fixture.ece_offering_id, randomUUID(), { facultyPersonId: fixture.faculty_person_id, expectedRevision: 0 }),
    AuthorizationError,
  );

  const student: ActorContext = { subject: "database-test-student", role: "student", personId: fixture.student_person_id, studentId: fixture.student_profile_id };
  const student2: ActorContext = { subject: "database-test-student-2", role: "student", personId: fixture.student2_person_id, studentId: fixture.student2_profile_id };
  const student10: ActorContext = { subject: "database-test-student-10", role: "student", personId: fixture.student10_person_id, studentId: fixture.student10_profile_id };
  await assert.rejects(
    registerForOffering(student2, randomUUID(), { offeringId: fixture.cse_offering_id }),
    (error: unknown) => error instanceof ConflictError && error.code === "PREREQUISITE_MISSING",
  );

  const registrationCommand = randomUUID();
  const registered = await registerForOffering(student, registrationCommand, { offeringId: fixture.cse_offering_id });
  const registeredDuplicate = await registerForOffering(student, registrationCommand, { offeringId: fixture.cse_offering_id });
  assert.equal(registered.duplicate, false);
  assert.equal(registeredDuplicate.duplicate, true);
  assert.deepEqual(registeredDuplicate.receipt, registered.receipt);
  const registrationId = (registered.registration as { id: string }).id;
  await assert.rejects(withdrawRegistration(student2, registrationId, randomUUID()), AuthorizationError);

  await pool.query(`UPDATE "${schema}".student_profiles SET completed_course_codes = '["CS301"]'::jsonb WHERE id IN ($1, $2)`, [fixture.student2_profile_id, fixture.student10_profile_id]);
  await assert.rejects(
    registerForOffering(student10, randomUUID(), { offeringId: fixture.cse_offering_id }),
    (error: unknown) => error instanceof ConflictError && error.code === "TIMETABLE_CLASH",
  );
  await pool.query(`UPDATE "${schema}".course_offerings SET capacity = 1 WHERE id = $1`, [fixture.cse_offering_id]);
  await assert.rejects(
    registerForOffering(student2, randomUUID(), { offeringId: fixture.cse_offering_id }),
    (error: unknown) => error instanceof ConflictError && error.code === "OFFERING_FULL",
  );

  const withdrawCommand = randomUUID();
  const withdrawn = await withdrawRegistration(student, registrationId, withdrawCommand);
  const withdrawnDuplicate = await withdrawRegistration(student, registrationId, withdrawCommand);
  assert.equal(withdrawn.duplicate, false);
  assert.equal(withdrawnDuplicate.duplicate, true);
  assert.deepEqual(withdrawnDuplicate.receipt, withdrawn.receipt);
});

test.after(async () => {
  await closePool();
});
