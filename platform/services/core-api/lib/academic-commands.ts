import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";

import { assertCommandId, findDuplicateCommand, getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole } from "./security";

const attendanceRecordInput = z.object({
  studentId: z.string().uuid(),
  status: z.enum(["present", "absent", "late", "excused"]),
});

export const submitAttendanceInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  records: z.array(attendanceRecordInput).min(1),
}).superRefine((value, context) => {
  if (new Set(value.records.map((record) => record.studentId)).size !== value.records.length) {
    context.addIssue({ code: "custom", message: "Each rostered student may appear only once" });
  }
});

const markInput = z.object({
  studentId: z.string().uuid(),
  score: z.number().nonnegative(),
  feedback: z.string().trim().max(500).default(""),
});

export const publishMarksInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  marks: z.array(markInput).min(1),
}).superRefine((value, context) => {
  if (new Set(value.marks.map((mark) => mark.studentId)).size !== value.marks.length) {
    context.addIssue({ code: "custom", message: "Each rostered student may appear only once" });
  }
});

export async function submitAttendance(actor: ActorContext, sessionId: string, commandId: string, input: z.infer<typeof submitAttendanceInput>) {
  assertCommandId(commandId);
  requireRole(actor, "faculty");

  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return { attendanceSession: duplicate.payload.attendanceSession, duplicate: true, receipt: duplicate.receipt };
    const session = await client.query<{
      id: string;
      status: string;
      revision: number;
      topic: string;
      course_offering_id: string;
      code: string;
      title: string;
      department_id: string;
    }>(
      `SELECT attendance.id, attendance.status, attendance.revision, attendance.topic, attendance.course_offering_id,
              course.code, course.title, course.department_id
       FROM attendance_sessions attendance
       JOIN course_offerings offering ON offering.id = attendance.course_offering_id
       JOIN courses course ON course.id = offering.course_id
       JOIN faculty_assignments assignment ON assignment.generation_id = attendance.generation_id
         AND assignment.course_offering_id = offering.id AND assignment.faculty_person_id = $3 AND assignment.active
       WHERE attendance.generation_id = $1 AND attendance.id = $2
       FOR UPDATE OF attendance`,
      [generationId, sessionId, actor.personId],
    );
    if (!session.rowCount) throw new NotFoundError("Attendance sheet not found");
    const sheet = session.rows[0]!;
    if (sheet.status === "locked") throw new ConflictError("ATTENDANCE_LOCKED", "This attendance sheet is locked");
    if (sheet.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "Attendance changed after this page loaded");

    const roster = await client.query<{ id: string }>(
      `SELECT student.id
       FROM student_profiles student
       JOIN registrations registration ON registration.student_id = student.id AND registration.generation_id = student.generation_id
       WHERE student.generation_id = $1 AND registration.course_offering_id = $2 AND registration.status = 'registered'
         AND student.id = ANY($3::uuid[])`,
      [generationId, sheet.course_offering_id, input.records.map((record) => record.studentId)],
    );
    if (roster.rowCount !== input.records.length) throw new ConflictError("ROSTER_MISMATCH", "Attendance may be submitted only for registered students");

    const previous = await client.query<{ student_id: string; status: string; revision: number }>(
      "SELECT student_id, status, revision FROM attendance_records WHERE generation_id = $1 AND attendance_session_id = $2",
      [generationId, sheet.id],
    );
    for (const record of input.records) {
      await client.query(
        `INSERT INTO attendance_records (id, generation_id, attendance_session_id, student_id, status, recorded_by_person_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (generation_id, attendance_session_id, student_id) DO UPDATE
         SET status = EXCLUDED.status, recorded_by_person_id = EXCLUDED.recorded_by_person_id,
             recorded_at = now(), revision = attendance_records.revision + 1`,
        [randomUUID(), generationId, sheet.id, record.studentId, record.status, actor.personId],
      );
    }
    const updated = await client.query<{ revision: number }>(
      "UPDATE attendance_sessions SET status = 'submitted', revision = revision + 1 WHERE id = $1 RETURNING revision",
      [sheet.id],
    );
    const payload = {
      departmentId: sheet.department_id,
      facultyPersonId: actor.personId,
      studentIds: input.records.map((record) => record.studentId),
      offering: { id: sheet.course_offering_id, code: sheet.code, title: sheet.title },
      attendanceSession: { id: sheet.id, topic: sheet.topic, status: "submitted", revision: updated.rows[0]!.revision },
      records: input.records,
      previous: previous.rows,
    };
    const receipt = await writeCommandLedger(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "attendance_session",
      aggregateId: sheet.id,
      eventType: "attendance.submitted",
      action: "submit_attendance",
      topic: "academic.attendance.submitted",
      payload,
      metadata: { expectedRevision: input.expectedRevision, recordCount: input.records.length },
    });
    return { attendanceSession: payload.attendanceSession, duplicate: false, receipt };
  });
}

export async function publishMarks(actor: ActorContext, assessmentId: string, commandId: string, input: z.infer<typeof publishMarksInput>) {
  assertCommandId(commandId);
  requireRole(actor, "faculty");

  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return { assessment: duplicate.payload.assessment, duplicate: true, receipt: duplicate.receipt };
    const assessment = await client.query<{
      id: string;
      title: string;
      maximum_score: string;
      revision: number;
      course_offering_id: string;
      code: string;
      course_title: string;
      department_id: string;
    }>(
      `SELECT assessment.id, assessment.title, assessment.maximum_score::text, assessment.revision,
              assessment.course_offering_id, course.code, course.title AS course_title, course.department_id
       FROM assessments assessment
       JOIN course_offerings offering ON offering.id = assessment.course_offering_id
       JOIN courses course ON course.id = offering.course_id
       JOIN faculty_assignments assignment ON assignment.generation_id = assessment.generation_id
         AND assignment.course_offering_id = offering.id AND assignment.faculty_person_id = $3 AND assignment.active
       WHERE assessment.generation_id = $1 AND assessment.id = $2
       FOR UPDATE OF assessment`,
      [generationId, assessmentId, actor.personId],
    );
    if (!assessment.rowCount) throw new NotFoundError("Assessment not found");
    const gradebook = assessment.rows[0]!;
    if (gradebook.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "Marks changed after this page loaded");
    const maximum = Number(gradebook.maximum_score);
    if (input.marks.some((mark) => mark.score > maximum)) throw new ConflictError("SCORE_OUT_OF_RANGE", `Scores must be between 0 and ${maximum}`);

    const roster = await client.query<{ id: string }>(
      `SELECT student.id
       FROM student_profiles student
       JOIN registrations registration ON registration.student_id = student.id AND registration.generation_id = student.generation_id
       WHERE student.generation_id = $1 AND registration.course_offering_id = $2 AND registration.status = 'registered'
         AND student.id = ANY($3::uuid[])`,
      [generationId, gradebook.course_offering_id, input.marks.map((mark) => mark.studentId)],
    );
    if (roster.rowCount !== input.marks.length) throw new ConflictError("ROSTER_MISMATCH", "Marks may be published only for registered students");
    const previous = await client.query<{ student_id: string; score: string; feedback: string; revision: number }>(
      "SELECT student_id, score::text, feedback, revision FROM marks WHERE generation_id = $1 AND assessment_id = $2",
      [generationId, gradebook.id],
    );
    for (const mark of input.marks) {
      await client.query(
        `INSERT INTO marks (id, generation_id, assessment_id, student_id, score, feedback, recorded_by_person_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (generation_id, assessment_id, student_id) DO UPDATE
         SET score = EXCLUDED.score, feedback = EXCLUDED.feedback, recorded_by_person_id = EXCLUDED.recorded_by_person_id,
             recorded_at = now(), revision = marks.revision + 1`,
        [randomUUID(), generationId, gradebook.id, mark.studentId, mark.score, mark.feedback, actor.personId],
      );
    }
    const updated = await client.query<{ revision: number }>(
      "UPDATE assessments SET published = true, revision = revision + 1 WHERE id = $1 RETURNING revision",
      [gradebook.id],
    );
    const payload = {
      departmentId: gradebook.department_id,
      facultyPersonId: actor.personId,
      studentIds: input.marks.map((mark) => mark.studentId),
      offering: { id: gradebook.course_offering_id, code: gradebook.code, title: gradebook.course_title },
      assessment: { id: gradebook.id, title: gradebook.title, maximumScore: maximum, published: true, revision: updated.rows[0]!.revision },
      marks: input.marks,
      previous: previous.rows,
    };
    const receipt = await writeCommandLedger(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "assessment",
      aggregateId: gradebook.id,
      eventType: "marks.published",
      action: "publish_marks",
      topic: "academic.marks.published",
      payload,
      metadata: { expectedRevision: input.expectedRevision, markCount: input.marks.length },
    });
    return { assessment: payload.assessment, duplicate: false, receipt };
  });
}
