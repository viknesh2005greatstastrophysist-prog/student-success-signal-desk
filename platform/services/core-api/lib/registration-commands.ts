import { randomUUID } from "node:crypto";
import { causalReceiptSchema, type ActorContext } from "@aura/contracts";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole, requireStudentScope } from "./security";

export const registerInput = z.object({ offeringId: z.string().uuid() });

function validateCommandId(commandId: string) {
  if (!z.string().uuid().safeParse(commandId).success) {
    throw new ConflictError("INVALID_IDEMPOTENCY_KEY", "A UUID idempotency key is required");
  }
}

async function currentGeneration(client: PoolClient) {
  const result = await client.query<{ generation_id: string }>(
    "SELECT current_generation_id AS generation_id FROM institution_revisions WHERE singleton = true",
  );
  return result.rows[0]!.generation_id;
}

async function duplicateReceipt(client: PoolClient, generationId: string, commandId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [commandId]);
  const result = await client.query<{
    command_id: string;
    event_id: string;
    audit_id: string;
    institution_revision: string;
    occurred_at: Date;
    payload: Record<string, unknown>;
  }>(
    `SELECT cr.command_id, cr.event_id, cr.audit_id, cr.institution_revision::text, cr.occurred_at, de.payload
     FROM command_receipts cr JOIN domain_events de ON de.id = cr.event_id
     WHERE cr.generation_id = $1 AND cr.command_id = $2`,
    [generationId, commandId],
  );
  if (!result.rowCount) return undefined;
  const row = result.rows[0]!;
  return {
    duplicate: true as const,
    payload: row.payload,
    receipt: causalReceiptSchema.parse({
      commandId: row.command_id,
      eventId: row.event_id,
      auditId: row.audit_id,
      institutionRevision: Number(row.institution_revision),
      occurredAt: row.occurred_at.toISOString(),
    }),
  };
}

async function recordMutation(client: PoolClient, input: {
  generationId: string;
  commandId: string;
  actorPersonId: string;
  aggregateId: string;
  eventType: "registration.created" | "registration.withdrawn";
  action: "register_course" | "withdraw_registration";
  payload: Record<string, unknown>;
}) {
  const revision = await client.query<{ revision: string }>(
    "UPDATE institution_revisions SET revision = revision + 1, updated_at = now() WHERE singleton = true RETURNING revision::text",
  );
  const eventId = randomUUID();
  const auditId = randomUUID();
  const occurredAt = new Date().toISOString();
  await client.query(
    `INSERT INTO domain_events (id, generation_id, aggregate_type, aggregate_id, event_type, command_id, actor_person_id, institution_revision, payload, occurred_at)
     VALUES ($1, $2, 'registration', $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [eventId, input.generationId, input.aggregateId, input.eventType, input.commandId, input.actorPersonId, revision.rows[0]!.revision, JSON.stringify(input.payload), occurredAt],
  );
  await client.query(
    "INSERT INTO outbox_items (id, generation_id, domain_event_id, topic, payload) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [randomUUID(), input.generationId, eventId, `academic.${input.eventType}`, JSON.stringify(input.payload)],
  );
  await client.query(
    `INSERT INTO audit_events (id, generation_id, command_id, event_id, actor_person_id, action, resource_type, resource_id, outcome, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'registration', $7, 'allowed', $8::jsonb, $9)`,
    [auditId, input.generationId, input.commandId, eventId, input.actorPersonId, input.action, input.aggregateId, JSON.stringify({ eventType: input.eventType }), occurredAt],
  );
  await client.query(
    `INSERT INTO command_receipts (id, generation_id, command_id, event_id, audit_id, institution_revision, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), input.generationId, input.commandId, eventId, auditId, revision.rows[0]!.revision, occurredAt],
  );
  return causalReceiptSchema.parse({
    commandId: input.commandId,
    eventId,
    auditId,
    institutionRevision: Number(revision.rows[0]!.revision),
    occurredAt,
  });
}

export async function registerForOffering(actor: ActorContext, commandId: string, input: z.infer<typeof registerInput>) {
  validateCommandId(commandId);
  requireRole(actor, "student");
  if (!actor.studentId) throw new ConflictError("STUDENT_PROFILE_MISSING", "This identity has no active student profile");

  return withCoreTransaction(async (client) => {
    const generationId = await currentGeneration(client);
    const duplicate = await duplicateReceipt(client, generationId, commandId);
    if (duplicate) return { registration: duplicate.payload.registration, duplicate: true, receipt: duplicate.receipt };

    const offering = await client.query<{
      id: string;
      course_id: string;
      code: string;
      title: string;
      department_id: string;
      capacity: number;
      status: string;
      window_status: string | null;
      opens_at: Date | null;
      closes_at: Date | null;
      faculty_person_id: string | null;
    }>(
      `SELECT o.id, o.course_id, c.code, c.title, c.department_id, o.capacity, o.status,
              rw.status AS window_status, rw.opens_at, rw.closes_at, fa.faculty_person_id
       FROM course_offerings o
       JOIN courses c ON c.id = o.course_id
       LEFT JOIN registration_windows rw ON rw.generation_id = o.generation_id AND rw.term_id = o.term_id AND rw.department_id = c.department_id
       LEFT JOIN faculty_assignments fa ON fa.generation_id = o.generation_id AND fa.course_offering_id = o.id AND fa.active
       WHERE o.generation_id = $1 AND o.id = $2
       FOR UPDATE OF o`,
      [generationId, input.offeringId],
    );
    if (!offering.rowCount) throw new NotFoundError("Offering not found");
    const course = offering.rows[0]!;

    const student = await client.query<{ department_id: string; completed_course_codes: string[] }>(
      "SELECT department_id, completed_course_codes FROM student_profiles WHERE generation_id = $1 AND id = $2",
      [generationId, actor.studentId],
    );
    if (!student.rowCount) throw new NotFoundError("Student profile not found");
    if (student.rows[0]!.department_id !== course.department_id) {
      throw new ConflictError("OUTSIDE_PROGRAMME", "This offering is outside your assigned department");
    }
    if (course.status !== "published") throw new ConflictError("OFFERING_NOT_OPEN", "This offering has not been published");
    const now = Date.now();
    if (course.window_status !== "open" || !course.opens_at || !course.closes_at || course.opens_at.getTime() > now || course.closes_at.getTime() < now) {
      throw new ConflictError("REGISTRATION_CLOSED", "The registration window is closed");
    }

    const existing = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM registrations WHERE generation_id = $1 AND student_id = $2 AND course_offering_id = $3",
      [generationId, actor.studentId, course.id],
    );
    if (existing.rows[0]?.status === "registered") throw new ConflictError("ALREADY_REGISTERED", "You are already registered for this offering");
    if (existing.rows[0]?.status === "completed") throw new ConflictError("COURSE_COMPLETED", "You have already completed this course");

    const prerequisiteRows = await client.query<{ code: string }>(
      `SELECT prerequisite.code
       FROM course_prerequisites cp JOIN courses prerequisite ON prerequisite.id = cp.prerequisite_course_id
       WHERE cp.generation_id = $1 AND cp.course_id = $2`,
      [generationId, course.course_id],
    );
    const completed = new Set(student.rows[0]!.completed_course_codes ?? []);
    const completedRows = await client.query<{ code: string }>(
      `SELECT c.code FROM registrations r
       JOIN course_offerings o ON o.id = r.course_offering_id
       JOIN courses c ON c.id = o.course_id
       WHERE r.generation_id = $1 AND r.student_id = $2 AND r.status = 'completed'`,
      [generationId, actor.studentId],
    );
    completedRows.rows.forEach((row) => completed.add(row.code));
    const missing = prerequisiteRows.rows.map((row) => row.code).filter((code) => !completed.has(code));
    if (missing.length) throw new ConflictError("PREREQUISITE_MISSING", `Complete ${missing.join(", ")} before registering`);

    const enrolment = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM registrations WHERE generation_id = $1 AND course_offering_id = $2 AND status = 'registered'",
      [generationId, course.id],
    );
    if (Number(enrolment.rows[0]!.count) >= course.capacity) throw new ConflictError("OFFERING_FULL", "This offering has reached capacity");

    const clash = await client.query<{ code: string }>(
      `SELECT existing_course.code
       FROM registrations r
       JOIN course_offerings existing_offering ON existing_offering.id = r.course_offering_id
       JOIN courses existing_course ON existing_course.id = existing_offering.course_id
       JOIN timetable_slots existing_slot ON existing_slot.course_offering_id = existing_offering.id
       JOIN timetable_slots candidate_slot ON candidate_slot.course_offering_id = $3
       WHERE r.generation_id = $1 AND r.student_id = $2 AND r.status = 'registered'
         AND existing_slot.weekday = candidate_slot.weekday
         AND existing_slot.starts_at < candidate_slot.ends_at
         AND existing_slot.ends_at > candidate_slot.starts_at
       LIMIT 1`,
      [generationId, actor.studentId, course.id],
    );
    if (clash.rowCount) throw new ConflictError("TIMETABLE_CLASH", `This class overlaps ${clash.rows[0]!.code}`);

    const registrationId = existing.rows[0]?.id ?? randomUUID();
    if (existing.rowCount) {
      await client.query("UPDATE registrations SET status = 'registered', grade = NULL, registered_at = now() WHERE id = $1", [registrationId]);
    } else {
      await client.query(
        "INSERT INTO registrations (id, generation_id, student_id, course_offering_id, status) VALUES ($1, $2, $3, $4, 'registered')",
        [registrationId, generationId, actor.studentId, course.id],
      );
    }
    const payload = {
      studentId: actor.studentId,
      departmentId: course.department_id,
      facultyPersonId: course.faculty_person_id,
      offering: { id: course.id, code: course.code, title: course.title },
      registration: { id: registrationId, status: "registered" },
      consequence: { facultyRoster: "student_added", hodEnrolment: Number(enrolment.rows[0]!.count) + 1 },
    };
    const receipt = await recordMutation(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateId: registrationId,
      eventType: "registration.created",
      action: "register_course",
      payload,
    });
    return { registration: payload.registration, duplicate: false, receipt };
  });
}

export async function withdrawRegistration(actor: ActorContext, registrationId: string, commandId: string) {
  validateCommandId(commandId);
  z.string().uuid().parse(registrationId);
  requireRole(actor, "student");

  return withCoreTransaction(async (client) => {
    const generationId = await currentGeneration(client);
    const duplicate = await duplicateReceipt(client, generationId, commandId);
    if (duplicate) return { registration: duplicate.payload.registration, duplicate: true, receipt: duplicate.receipt };
    const result = await client.query<{
      id: string;
      student_id: string;
      status: string;
      offering_id: string;
      code: string;
      title: string;
      department_id: string;
      faculty_person_id: string | null;
    }>(
      `SELECT r.id, r.student_id, r.status, o.id AS offering_id, c.code, c.title, c.department_id, fa.faculty_person_id
       FROM registrations r
       JOIN course_offerings o ON o.id = r.course_offering_id
       JOIN courses c ON c.id = o.course_id
       LEFT JOIN faculty_assignments fa ON fa.generation_id = r.generation_id AND fa.course_offering_id = o.id AND fa.active
       WHERE r.generation_id = $1 AND r.id = $2
       FOR UPDATE OF r`,
      [generationId, registrationId],
    );
    if (!result.rowCount) throw new NotFoundError("Registration not found");
    const registration = result.rows[0]!;
    requireStudentScope(actor, registration.student_id);
    if (registration.status !== "registered") throw new ConflictError("NOT_REGISTERED", "Only an active registration can be withdrawn");
    await client.query("UPDATE registrations SET status = 'withdrawn' WHERE id = $1", [registration.id]);
    const enrolment = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM registrations WHERE generation_id = $1 AND course_offering_id = $2 AND status = 'registered'",
      [generationId, registration.offering_id],
    );
    const payload = {
      studentId: registration.student_id,
      departmentId: registration.department_id,
      facultyPersonId: registration.faculty_person_id,
      offering: { id: registration.offering_id, code: registration.code, title: registration.title },
      registration: { id: registration.id, status: "withdrawn" },
      consequence: { facultyRoster: "student_removed", hodEnrolment: Number(enrolment.rows[0]!.count) },
    };
    const receipt = await recordMutation(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateId: registration.id,
      eventType: "registration.withdrawn",
      action: "withdraw_registration",
      payload,
    });
    return { registration: payload.registration, duplicate: false, receipt };
  });
}
