import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { publishMarks, submitAttendance } from "../lib/academic-commands";
import type { AuthenticatedActor } from "../lib/authentication";
import { publishAndAssignOffering } from "../lib/commands";
import { closePool, getPool } from "../lib/db";
import { ConflictError } from "../lib/http";
import { revokeParentGrant } from "../lib/grant-commands";
import { migrateCoreDatabase } from "../lib/migrations";
import { loadPortalSnapshot } from "../lib/projections";
import { createPaymentAttempt, loadPaymentReceipt } from "../lib/payment-commands";
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
    faculty2_person_id: string; parent_person_id: string; attendance_session_id: string; assessment_id: string; invoice_id: string; marks_grant_id: string;
  }>(
    `SELECT ir.current_generation_id AS generation_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'hod.cse@aura.invalid') AS hod_person_id,
      (SELECT d.id FROM "${schema}".departments d WHERE d.generation_id = ir.current_generation_id AND d.code = 'CSE') AS cse_department_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'faculty1@aura.invalid') AS faculty_person_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'faculty2@aura.invalid') AS faculty2_person_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'parent1@aura.invalid') AS parent_person_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student1@aura.invalid') AS student_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-001') AS student_profile_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student2@aura.invalid') AS student2_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-002') AS student2_profile_id,
      (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'student10@aura.invalid') AS student10_person_id,
      (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-010') AS student10_profile_id,
      (SELECT o.id FROM "${schema}".course_offerings o JOIN "${schema}".courses c ON c.id = o.course_id WHERE o.generation_id = ir.current_generation_id AND c.code = 'CS401') AS cse_offering_id,
      (SELECT attendance.id FROM "${schema}".attendance_sessions attendance JOIN "${schema}".course_offerings o ON o.id = attendance.course_offering_id JOIN "${schema}".courses c ON c.id = o.course_id WHERE attendance.generation_id = ir.current_generation_id AND c.code = 'CS401') AS attendance_session_id,
      (SELECT assessment.id FROM "${schema}".assessments assessment JOIN "${schema}".course_offerings o ON o.id = assessment.course_offering_id JOIN "${schema}".courses c ON c.id = o.course_id WHERE assessment.generation_id = ir.current_generation_id AND c.code = 'CS401') AS assessment_id,
      (SELECT invoice.id FROM "${schema}".fee_invoices invoice WHERE invoice.generation_id = ir.current_generation_id AND invoice.invoice_number = 'INV-AURA-2026-001') AS invoice_id,
      (SELECT grant_row.id FROM "${schema}".parent_field_grants grant_row JOIN "${schema}".parent_links link ON link.id = grant_row.parent_link_id WHERE grant_row.generation_id = ir.current_generation_id AND link.parent_person_id = (SELECT p.id FROM "${schema}".people p WHERE p.generation_id = ir.current_generation_id AND p.email = 'parent1@aura.invalid') AND link.student_id = (SELECT sp.id FROM "${schema}".student_profiles sp WHERE sp.generation_id = ir.current_generation_id AND sp.register_number = 'SYN-CSE-001') AND grant_row.field_group = 'marks') AS marks_grant_id,
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

  const faculty: ActorContext = { subject: "database-test-faculty", role: "faculty", personId: fixture.faculty_person_id, departmentId: fixture.cse_department_id };
  const unassignedFaculty: ActorContext = { subject: "database-test-unassigned-faculty", role: "faculty", personId: fixture.faculty2_person_id, departmentId: fixture.cse_department_id };
  await assert.rejects(
    submitAttendance(unassignedFaculty, fixture.attendance_session_id, randomUUID(), { expectedRevision: 0, records: [{ studentId: fixture.student_profile_id, status: "present" }] }),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 404,
  );
  const attendanceCommand = randomUUID();
  const attendance = await submitAttendance(faculty, fixture.attendance_session_id, attendanceCommand, { expectedRevision: 0, records: [{ studentId: fixture.student_profile_id, status: "present" }] });
  const attendanceDuplicate = await submitAttendance(faculty, fixture.attendance_session_id, attendanceCommand, { expectedRevision: 0, records: [{ studentId: fixture.student_profile_id, status: "present" }] });
  assert.equal(attendance.duplicate, false);
  assert.equal(attendanceDuplicate.duplicate, true);
  assert.deepEqual(attendanceDuplicate.receipt, attendance.receipt);

  await assert.rejects(
    publishMarks(faculty, fixture.assessment_id, randomUUID(), { expectedRevision: 0, marks: [{ studentId: fixture.student_profile_id, score: 101, feedback: "invalid" }] }),
    (error: unknown) => error instanceof ConflictError && error.code === "SCORE_OUT_OF_RANGE",
  );
  const marksCommand = randomUUID();
  const marks = await publishMarks(faculty, fixture.assessment_id, marksCommand, { expectedRevision: 0, marks: [{ studentId: fixture.student_profile_id, score: 82, feedback: "Clear reasoning." }] });
  const marksDuplicate = await publishMarks(faculty, fixture.assessment_id, marksCommand, { expectedRevision: 0, marks: [{ studentId: fixture.student_profile_id, score: 82, feedback: "Clear reasoning." }] });
  assert.equal(marks.duplicate, false);
  assert.equal(marksDuplicate.duplicate, true);
  assert.deepEqual(marksDuplicate.receipt, marks.receipt);

  const parent: AuthenticatedActor = { subject: "database-test-parent", role: "parent", personId: fixture.parent_person_id, displayName: "Lakshmi Rao", email: "parent1@aura.invalid", clientId: portalOidcClients.parent };
  const granted = await loadPortalSnapshot(parent) as { childAcademics?: { marks?: unknown[]; attendance?: unknown[] } };
  assert.ok((granted.childAcademics?.marks?.length ?? 0) >= 2);
  assert.ok((granted.childAcademics?.attendance?.length ?? 0) >= 2);
  const revokeCommand = randomUUID();
  const grantRevoked = await revokeParentGrant(student, fixture.marks_grant_id, revokeCommand, { expectedRevision: 0 });
  const grantRevokedDuplicate = await revokeParentGrant(student, fixture.marks_grant_id, revokeCommand, { expectedRevision: 0 });
  assert.equal(grantRevoked.grant.granted, false);
  assert.equal(grantRevokedDuplicate.duplicate, true);
  assert.deepEqual(grantRevokedDuplicate.receipt, grantRevoked.receipt);
  const revoked = await loadPortalSnapshot(parent) as { childAcademics?: { marks?: unknown[] } };
  assert.equal(revoked.childAcademics?.marks, undefined);

  const declineCommand = randomUUID();
  const declined = await createPaymentAttempt(parent, fixture.invoice_id, declineCommand, { expectedRevision: 0, scenario: "decline" });
  const declinedDuplicate = await createPaymentAttempt(parent, fixture.invoice_id, declineCommand, { expectedRevision: 0, scenario: "decline" });
  assert.equal(declined.transaction.status, "failed");
  assert.equal(declinedDuplicate.duplicate, true);
  assert.deepEqual(declinedDuplicate.receipt, declined.receipt);

  const paymentCommand = randomUUID();
  const paid = await createPaymentAttempt(parent, fixture.invoice_id, paymentCommand, { expectedRevision: 0, scenario: "success" });
  const paidDuplicate = await createPaymentAttempt(parent, fixture.invoice_id, paymentCommand, { expectedRevision: 0, scenario: "success" });
  assert.equal(paid.invoice.status, "paid");
  assert.equal(paid.transaction.status, "captured");
  assert.equal(paidDuplicate.duplicate, true);
  assert.deepEqual(paidDuplicate.receipt, paid.receipt);
  const paymentCount = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schema}".payment_transactions WHERE generation_id = $1 AND invoice_id = $2`,
    [fixture.generation_id, fixture.invoice_id],
  );
  assert.equal(Number(paymentCount.rows[0]!.count), 2);
  const paymentReceipt = await loadPaymentReceipt(parent, paid.transaction.receiptId!);
  assert.equal(paymentReceipt.invoiceNumber, "INV-AURA-2026-001");
  assert.equal(paymentReceipt.amountPaise, 4500000);

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
