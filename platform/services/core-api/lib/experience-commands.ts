import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ActorContext } from "@aura/contracts";
import type { PoolClient } from "pg";
import { withCoreTransaction } from "./db";
import {
  assertCommandId,
  findDuplicateCommand,
  getCurrentGeneration,
  writeCommandLedger,
} from "./command-ledger";
import { ConflictError, NotFoundError } from "./http";
import { AuthorizationError, requireRole } from "./security";
import { requireExperienceStudent } from "./experience-queries";
import { requireLmsCourse } from "./lms-queries";
import {
  registerForOffering,
  withdrawRegistration,
  requireOpenSubmission,
} from "./registration-commands";
import { digest } from "./chapter11/engine";
import { assertStudentNotFrozen } from "./chapter11/frozen";
import {
  MEETINGS_NOT_READY,
  collegeDate,
  meetingOutcome,
  meetingTablesPresent,
  reportCheckinNote,
  validateMeeting,
} from "./meetings";
import {
  NOTE_MAX,
  STAFF_MESSAGES_NOT_READY,
  messageBody,
  reminderTarget,
  staffMessagesPresent,
} from "./staff-messages";
const uuid = z.string().uuid();
const revision = z.number().int().nonnegative();
const reason = z.string().trim().min(5).max(1000);
const editable = { id: uuid.optional(), expectedRevision: revision.optional() };
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const slot = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startsAt: z.string().regex(/^\d{2}:\d{2}$/),
    endsAt: z.string().regex(/^\d{2}:\d{2}$/),
    room: z.string().trim().min(1).max(100),
  })
  .strict()
  .refine(
    (s) =>
      s.startsAt < s.endsAt &&
      s.endsAt < "24:00" &&
      s.startsAt.slice(3) < "60" &&
      s.endsAt.slice(3) < "60",
    "Enter a valid start and end time",
  );
export const experienceCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit-registration"),
      termId: uuid,
      offeringIds: z.array(uuid).min(1).max(12),
      expectedRevision: z.number().int().min(-1),
    })
    .strict(),
  z
    .object({
      action: z.literal("reopen-registration"),
      studentId: uuid,
      termId: uuid,
      expectedRevision: revision,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("assign-mentor"),
      studentId: uuid,
      facultyId: uuid,
      expectedRevision: z.number().int().min(-1),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-course"),
      ...editable,
      termId: uuid,
      code: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,20}$/),
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().max(2000),
      credits: z.number().int().min(1).max(8),
      section: z.string().trim().min(1).max(20),
      capacity: z.number().int().min(1).max(1000),
      status: z.enum(["draft", "published", "closed"]),
      facultyId: uuid,
      slots: z.array(slot).min(1).max(14),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-window"),
      id: uuid,
      expectedRevision: revision,
      opensAt: z.string().datetime({ offset: true }),
      closesAt: z.string().datetime({ offset: true }),
      status: z.enum(["open", "scheduled", "closed"]),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-person"),
      id: uuid,
      expectedRevision: revision,
      name: z.string().trim().min(2).max(100),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-grading"),
      expectedRevision: revision,
      label: z.string().trim().min(3).max(100),
      bands: z
        .array(
          z
            .object({
              minimum: z.number().min(0).max(100),
              points: z.number().min(0).max(10),
              letter: z.string().trim().min(1).max(8),
            })
            .strict(),
        )
        .min(2)
        .max(20),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("publish-result"),
      studentId: uuid,
      offeringId: uuid,
      expectedRevision: z.number().int().min(-1),
      percentage: z.number().min(0).max(100),
      published: z.boolean(),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-followup"),
      ...editable,
      studentId: uuid,
      dueOn: date,
      note: z.string().trim().min(5).max(3000),
      shared: z.boolean(),
      status: z.enum(["planned", "in_progress", "completed"]),
      outcome: z.string().trim().max(3000),
      reason,
    })
    .strict(),
  z
    .object({
      // The conversation with the student about the AI report (meetings.ts): the day
      // they met, the reasons from the fixed list and a note. Completes the case's
      // check-in. The report is named by its support case (the draft may still be at
      // the gate) or by its approved plan. The audit reason is fixed, so none is typed.
      action: z.literal("record-meeting"),
      studentId: uuid,
      supportCaseId: uuid.optional(),
      supportPlanId: uuid.optional(),
      followupId: uuid.optional(),
      metOn: z.string().trim().max(10),
      reasons: z.array(z.string().trim().min(1).max(80)).max(10),
      note: z.string().trim().max(3000).default(""),
      agreedNextStep: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z
    .object({
      // The department head asks a mentor why the conversation about an AI report has
      // not been submitted (staff-messages.ts): the standard reminder plus an optional
      // note. Nothing is ever sent automatically.
      action: z.literal("send-message"),
      supportCaseId: uuid,
      note: z.string().trim().max(NOTE_MAX).default(""),
    })
    .strict(),
  z
    .object({
      // The recipient marks a message from the department head as read.
      action: z.literal("mark-message-read"),
      messageId: uuid,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-attendance"),
      ...editable,
      offeringId: uuid,
      sessionDate: date,
      topic: z.string().trim().min(3).max(160),
      records: z
        .array(
          z
            .object({
              studentId: uuid,
              status: z.enum(["present", "absent", "late", "excused"]),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("save-marks"),
      ...editable,
      offeringId: uuid,
      title: z.string().trim().min(3).max(160),
      maximumScore: z.number().positive().max(1000),
      weightPercent: z.number().min(0).max(100),
      marks: z
        .array(
          z
            .object({
              studentId: uuid,
              score: z.number().min(0),
              feedback: z.string().max(500),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
      reason,
    })
    .strict(),
]);
export async function recordChange(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
  resourceType: string,
  id: string,
  why: string,
  previous: unknown,
  updated: unknown,
) {
  await client.query(
    "INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)",
    [
      randomUUID(),
      generation,
      actor.personId,
      resourceType,
      id,
      why,
      previous ? JSON.stringify(previous) : null,
      JSON.stringify(updated),
    ],
  );
}
function fresh(actual: number | undefined, expected: number | undefined) {
  if (actual !== expected)
    throw new ConflictError(
      "STALE_VERSION",
      "This record changed. Reload it before saving again.",
    );
}
async function facultyInDepartment(
  client: PoolClient,
  gen: string,
  actor: ActorContext,
  id: string,
) {
  const r = await client.query(
    "SELECT id FROM role_assignments WHERE generation_id=$1 AND person_id=$2 AND department_id=$3 AND role='faculty' AND active",
    [gen, id, actor.departmentId],
  );
  if (!r.rowCount)
    throw new AuthorizationError(
      "Choose an active faculty member in your department",
    );
}
export async function experienceCommand(
  actor: ActorContext,
  commandId: string,
  raw: unknown,
) {
  assertCommandId(commandId);
  const input = experienceCommandSchema.parse(raw);
  const inputHash = digest(input);
  return withCoreTransaction(async (client) => {
    const gen = await getCurrentGeneration(client);
    const prior = await findDuplicateCommand(
      client,
      gen,
      commandId,
      actor.personId,
    );
    if (prior) {
      if (prior.payload.inputHash !== inputHash)
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "This request identifier was already used for another change",
        );
      return {
        id: prior.payload.resourceId,
        duplicate: true,
        receipt: prior.receipt,
      };
    }
    let id: string = randomUUID();
    let previous: unknown = null;
    let updated: Record<string, unknown> = {};
    let resource: string = input.action;
    let studentId: string | undefined;
    let facultyId: string | undefined;
    let eventType = `experience.${input.action}`;
    if (input.action === "submit-registration") {
      requireRole(actor, "student");
      if (!actor.studentId)
        throw new AuthorizationError("Student profile is missing");
      studentId = actor.studentId;
      if (new Set(input.offeringIds).size !== input.offeringIds.length)
        throw new ConflictError("DUPLICATE_COURSE", "Select each course once");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`courses:${gen}:${actor.departmentId}`],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`registration:${gen}:${studentId}`],
      );
      await requireOpenSubmission(client, gen, studentId, input.termId);
      const existing = (
        await client.query<{ id: string; revision: number; status: string }>(
          "SELECT id,revision,status FROM registration_submissions WHERE generation_id=$1 AND student_id=$2 AND term_id=$3 FOR UPDATE",
          [gen, studentId, input.termId],
        )
      ).rows[0];
      fresh(existing?.revision ?? -1, input.expectedRevision);
      const offerings = await client.query<{ id: string; course_id: string }>(
        "SELECT o.id,o.course_id FROM course_offerings o JOIN terms t ON t.id=o.term_id WHERE o.generation_id=$1 AND o.term_id=$2 AND o.id=ANY($3::uuid[]) AND t.active ORDER BY o.id FOR UPDATE OF o",
        [gen, input.termId, input.offeringIds],
      );
      if (offerings.rowCount !== input.offeringIds.length)
        throw new ConflictError(
          "WRONG_TERM",
          "Choose courses in the current semester",
        );
      if (
        new Set(offerings.rows.map((o) => o.course_id)).size !==
        offerings.rowCount
      )
        throw new ConflictError(
          "DUPLICATE_COURSE",
          "Choose only one section of each course",
        );
      const registrations = await client.query<{
        id: string;
        course_offering_id: string;
      }>(
        "SELECT r.id,r.course_offering_id FROM registrations r JOIN course_offerings o ON o.id=r.course_offering_id WHERE r.generation_id=$1 AND r.student_id=$2 AND o.term_id=$3 AND r.status='registered' ORDER BY r.course_offering_id",
        [gen, studentId, input.termId],
      );
      previous = registrations.rows;
      for (const r of registrations.rows)
        if (!input.offeringIds.includes(r.course_offering_id))
          await withdrawRegistration(actor, r.id, randomUUID(), client);
      for (const o of offerings.rows)
        if (!registrations.rows.some((r) => r.course_offering_id === o.id))
          await registerForOffering(
            actor,
            randomUUID(),
            { offeringId: o.id },
            client,
          );
      // Existing selections also need an open window; a final submission is not a bypass.
      const window = await client.query(
        "SELECT id FROM registration_windows WHERE generation_id=$1 AND term_id=$2 AND department_id=$3 AND status='open' AND opens_at<=now() AND closes_at>=now()",
        [gen, input.termId, actor.departmentId],
      );
      if (!window.rowCount)
        throw new ConflictError(
          "REGISTRATION_CLOSED",
          "The registration window is closed",
        );
      id = existing?.id ?? id;
      resource = "registration_submissions";
      await client.query(
        "INSERT INTO registration_submissions(id,generation_id,student_id,term_id,status,submitted_at) VALUES($1,$2,$3,$4,'submitted',now()) ON CONFLICT(generation_id,student_id,term_id) DO UPDATE SET status='submitted',revision=registration_submissions.revision+1,submitted_at=now()",
        [id, gen, studentId, input.termId],
      );
      updated = {
        studentId,
        termId: input.termId,
        offeringIds: input.offeringIds,
        status: "submitted",
      };
    } else if (input.action === "reopen-registration") {
      requireRole(actor, "hod");
      await requireExperienceStudent(client, gen, actor, input.studentId);
      studentId = input.studentId;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`courses:${gen}:${actor.departmentId}`],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`registration:${gen}:${studentId}`],
      );
      const row = (
        await client.query<{ id: string; revision: number; status: string }>(
          "SELECT * FROM registration_submissions WHERE generation_id=$1 AND student_id=$2 AND term_id=$3 FOR UPDATE",
          [gen, studentId, input.termId],
        )
      ).rows[0];
      if (!row) throw new NotFoundError("Submitted course selection not found");
      fresh(row.revision, input.expectedRevision);
      if (row.status !== "submitted")
        throw new ConflictError(
          "ALREADY_OPEN",
          "Course selection is already open",
        );
      id = row.id;
      previous = row;
      resource = "registration_submissions";
      await client.query(
        "UPDATE registration_submissions SET status='open',revision=revision+1 WHERE id=$1",
        [id],
      );
      updated = {
        ...row,
        status: "open",
        revision: row.revision + 1,
        studentId,
      };
    } else if (input.action === "assign-mentor") {
      requireRole(actor, "hod");
      await requireExperienceStudent(client, gen, actor, input.studentId);
      await facultyInDepartment(client, gen, actor, input.facultyId);
      studentId = input.studentId;
      facultyId = input.facultyId;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`mentor:${gen}:${studentId}`],
      );
      const row = (
        await client.query<{ id: string; revision: number }>(
          "SELECT * FROM mentor_assignments WHERE generation_id=$1 AND student_id=$2 FOR UPDATE",
          [gen, studentId],
        )
      ).rows[0];
      fresh(row?.revision ?? -1, input.expectedRevision);
      id = row?.id ?? id;
      previous = row;
      resource = "mentor_assignments";
      await client.query(
        "INSERT INTO mentor_assignments(id,generation_id,student_id,faculty_person_id,assigned_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(generation_id,student_id) DO UPDATE SET faculty_person_id=$4,assigned_by=$5,revision=mentor_assignments.revision+1,updated_at=now()",
        [id, gen, studentId, facultyId, actor.personId],
      );
      updated = { studentId, facultyId };
    } else if (input.action === "save-course") {
      requireRole(actor, "hod");
      await facultyInDepartment(client, gen, actor, input.facultyId);
      facultyId = input.facultyId;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`courses:${gen}:${actor.departmentId}`],
      );
      const term = await client.query(
        "SELECT id FROM terms WHERE generation_id=$1 AND id=$2",
        [gen, input.termId],
      );
      if (!term.rowCount) throw new NotFoundError("Semester not found");
      let courseId: string = randomUUID();
      id = input.id ?? id;
      if (input.id) {
        const row = (
          await client.query<{
            course_id: string;
            revision: number;
            term_id: string;
          }>(
            `SELECT o.*,c.code,c.title,c.description,c.credits FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND o.id=$2 AND c.department_id=$3 FOR UPDATE OF o,c`,
            [gen, id, actor.departmentId],
          )
        ).rows[0];
        if (!row) throw new NotFoundError("Course not found");
        fresh(row.revision, input.expectedRevision);
        if (row.term_id !== input.termId)
          throw new ConflictError(
            "TERM_FIXED",
            "Create a new offering to move a course to another semester",
          );
        courseId = row.course_id;
        previous = {
          ...row,
          slots: (
            await client.query(
              "SELECT * FROM timetable_slots WHERE course_offering_id=$1",
              [id],
            )
          ).rows,
          faculty: (
            await client.query(
              "SELECT faculty_person_id FROM faculty_assignments WHERE course_offering_id=$1 AND active",
              [id],
            )
          ).rows,
        };
        const enrolled = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM registrations WHERE course_offering_id=$1 AND status='registered'",
          [id],
        );
        if (input.capacity < enrolled.rows[0]!.count)
          throw new ConflictError(
            "CAPACITY",
            "Capacity cannot be lower than current enrolment",
          );
        const creditsChanged =
          (row as typeof row & { credits: number }).credits !== input.credits;
        if (
          creditsChanged &&
          (
            await client.query(
              "SELECT id FROM course_results WHERE course_offering_id=$1 AND published LIMIT 1",
              [id],
            )
          ).rowCount
        )
          throw new ConflictError(
            "PUBLISHED_CREDITS",
            "Credits cannot change after results are published",
          );
      }
      for (let i = 0; i < input.slots.length; i++) {
        const s = input.slots[i]!;
        if (
          input.slots.some(
            (other, j) =>
              j < i &&
              other.weekday === s.weekday &&
              other.startsAt < s.endsAt &&
              other.endsAt > s.startsAt,
          )
        )
          throw new ConflictError("TIMETABLE_CLASH", "Two class times overlap");
        const clash = await client.query(
          `SELECT c.code FROM timetable_slots ts JOIN course_offerings o ON o.id=ts.course_offering_id JOIN courses c ON c.id=o.course_id WHERE ts.generation_id=$1 AND o.term_id=$2 AND o.id<>$3 AND o.status<>'closed' AND ts.weekday=$4 AND ts.starts_at<$6::time AND ts.ends_at>$5::time AND (ts.room=$7 OR EXISTS(SELECT 1 FROM faculty_assignments fa WHERE fa.course_offering_id=o.id AND fa.faculty_person_id=$8 AND fa.active) OR EXISTS(SELECT 1 FROM registrations a JOIN registrations b ON b.student_id=a.student_id AND b.status='registered' WHERE a.course_offering_id=$3 AND a.status='registered' AND b.course_offering_id=o.id)) LIMIT 1`,
          [
            gen,
            input.termId,
            id,
            s.weekday,
            s.startsAt,
            s.endsAt,
            s.room,
            input.facultyId,
          ],
        );
        if (clash.rowCount)
          throw new ConflictError(
            "TIMETABLE_CLASH",
            `This time conflicts with ${clash.rows[0].code} for the faculty member, room or enrolled students`,
          );
      }
      if (input.id) {
        await client.query(
          "UPDATE courses SET code=$2,title=$3,description=$4,credits=$5 WHERE id=$1",
          [courseId, input.code, input.title, input.description, input.credits],
        );
        await client.query(
          "UPDATE course_offerings SET section=$2,capacity=$3,status=$4,revision=revision+1,published_at=CASE WHEN $4='published' THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=$1",
          [id, input.section, input.capacity, input.status],
        );
      } else {
        await client.query(
          "INSERT INTO courses(id,generation_id,department_id,code,title,description,credits) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            courseId,
            gen,
            actor.departmentId,
            input.code,
            input.title,
            input.description,
            input.credits,
          ],
        );
        await client.query(
          "INSERT INTO course_offerings(id,generation_id,course_id,term_id,section,capacity,status,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7='published' THEN now() END)",
          [
            id,
            gen,
            courseId,
            input.termId,
            input.section,
            input.capacity,
            input.status,
          ],
        );
      }
      await client.query(
        "UPDATE faculty_assignments SET active=false WHERE course_offering_id=$1",
        [id],
      );
      await client.query(
        "INSERT INTO faculty_assignments(id,generation_id,faculty_person_id,course_offering_id,assigned_by_person_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(generation_id,faculty_person_id,course_offering_id) DO UPDATE SET active=true,assigned_by_person_id=$5,assigned_at=now()",
        [randomUUID(), gen, facultyId, id, actor.personId],
      );
      await client.query(
        "DELETE FROM timetable_slots WHERE course_offering_id=$1",
        [id],
      );
      for (const s of input.slots)
        await client.query(
          "INSERT INTO timetable_slots(id,generation_id,course_offering_id,weekday,starts_at,ends_at,room) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [randomUUID(), gen, id, s.weekday, s.startsAt, s.endsAt, s.room],
        );
      resource = "course_offerings";
      updated = { ...input, courseId };
    } else if (input.action === "save-window") {
      requireRole(actor, "hod");
      if (Date.parse(input.closesAt) <= Date.parse(input.opensAt))
        throw new ConflictError(
          "INVALID_WINDOW",
          "Closing time must be after opening time",
        );
      const row = (
        await client.query<{ revision: number }>(
          "SELECT * FROM registration_windows WHERE generation_id=$1 AND id=$2 AND department_id=$3 FOR UPDATE",
          [gen, input.id, actor.departmentId],
        )
      ).rows[0];
      if (!row) throw new NotFoundError("Registration window not found");
      fresh(row.revision, input.expectedRevision);
      id = input.id;
      previous = row;
      resource = "registration_windows";
      await client.query(
        "UPDATE registration_windows SET opens_at=$2,closes_at=$3,status=$4,revision=revision+1 WHERE id=$1",
        [id, input.opensAt, input.closesAt, input.status],
      );
      updated = { ...input };
    } else if (input.action === "save-person") {
      requireRole(actor, "hod");
      const row = (
        await client.query<{ revision: number }>(
          `SELECT p.* FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.active AND r.role IN ('student','faculty') WHERE p.generation_id=$1 AND p.id=$2 AND r.department_id=$3 FOR UPDATE OF p`,
          [gen, input.id, actor.departmentId],
        )
      ).rows[0];
      if (!row) throw new NotFoundError("Person not found");
      fresh(row.revision, input.expectedRevision);
      id = input.id;
      previous = row;
      resource = "people";
      await client.query(
        "UPDATE people SET display_name=$2,revision=revision+1 WHERE id=$1",
        [id, input.name],
      );
      updated = { ...input };
    } else if (input.action === "save-grading") {
      requireRole(actor, "hod");
      const bands = [...input.bands].sort((a, b) => b.minimum - a.minimum);
      if (
        bands.at(-1)!.minimum !== 0 ||
        new Set(bands.map((b) => b.minimum)).size !== bands.length ||
        bands.some((b, i) => i > 0 && b.points > bands[i - 1]!.points)
      )
        throw new ConflictError(
          "INVALID_SCALE",
          "Use unique thresholds down to zero, with grade points increasing as marks increase",
        );
      const row = (
        await client.query<{ id: string; revision: number }>(
          "SELECT * FROM grading_scales WHERE generation_id=$1 AND department_id=$2 FOR UPDATE",
          [gen, actor.departmentId],
        )
      ).rows[0];
      if (!row) throw new NotFoundError("Grade scale not found");
      fresh(row.revision, input.expectedRevision);
      id = row.id;
      previous = row;
      resource = "grading_scales";
      await client.query(
        "UPDATE grading_scales SET label=$2,bands=$3::jsonb,revision=revision+1 WHERE id=$1",
        [id, input.label, JSON.stringify(bands)],
      );
      updated = { label: input.label, bands };
    } else if (input.action === "publish-result") {
      requireRole(actor, "faculty", "hod");
      await requireLmsCourse(client, gen, actor, input.offeringId, true);
      studentId = input.studentId;
      const registration = await client.query(
        "SELECT id FROM registrations WHERE generation_id=$1 AND student_id=$2 AND course_offering_id=$3 AND status IN ('registered','completed') FOR UPDATE",
        [gen, studentId, input.offeringId],
      );
      if (!registration.rowCount)
        throw new NotFoundError("Student is not enrolled in this course");
      const row = (
        await client.query<{ id: string; revision: number }>(
          "SELECT * FROM course_results WHERE generation_id=$1 AND student_id=$2 AND course_offering_id=$3 FOR UPDATE",
          [gen, studentId, input.offeringId],
        )
      ).rows[0];
      fresh(row?.revision ?? -1, input.expectedRevision);
      id = row?.id ?? id;
      previous = row;
      resource = "course_results";
      const scale = (
        await client.query<{
          bands: { minimum: number; points: number; letter: string }[];
          revision: number;
        }>(
          "SELECT bands,revision FROM grading_scales WHERE generation_id=$1 AND department_id=$2 FOR SHARE",
          [gen, actor.departmentId],
        )
      ).rows[0];
      if (!scale) throw new NotFoundError("Grade scale not found");
      const band = [...scale.bands]
        .sort((a, b) => b.minimum - a.minimum)
        .find((b) => input.percentage >= b.minimum)!;
      await client.query(
        "INSERT INTO course_results(id,generation_id,student_id,course_offering_id,percentage,grade_point,letter,scale_revision,published,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(generation_id,student_id,course_offering_id) DO UPDATE SET percentage=$5,grade_point=$6,letter=$7,scale_revision=$8,published=$9,recorded_by=$10,recorded_at=now(),revision=course_results.revision+1",
        [
          id,
          gen,
          studentId,
          input.offeringId,
          input.percentage,
          band.points,
          band.letter,
          scale.revision,
          input.published,
          actor.personId,
        ],
      );
      updated = {
        studentId,
        offeringId: input.offeringId,
        percentage: input.percentage,
        points: band.points,
        letter: band.letter,
        published: input.published,
        scaleRevision: scale.revision,
      };
    } else if (input.action === "save-followup") {
      // The assigned mentor, or the department head for a student in the
      // department, schedules or updates a follow-up (chapter11/authority.ts);
      // requireExperienceStudent admits a faculty member only for their own mentee
      // and the department head only inside the department. The follow-up stays
      // assigned to the student's mentor.
      requireRole(actor, "faculty", "hod");
      const { student } = await requireExperienceStudent(
        client,
        gen,
        actor,
        input.studentId,
      );
      studentId = input.studentId;
      await assertStudentNotFrozen(client, studentId);
      facultyId = student.mentor_id ?? undefined;
      if (!facultyId)
        throw new ConflictError(
          "NO_MENTOR",
          "Assign a mentor before scheduling a follow-up",
        );
      if (input.status === "completed" && input.outcome.length < 5)
        throw new ConflictError(
          "OUTCOME_REQUIRED",
          "Record what happened before completing the follow-up",
        );
      id = input.id ?? id;
      resource = "support_followups";
      if (input.id) {
        const row = (
          await client.query<{ revision: number }>(
            "SELECT * FROM support_followups WHERE generation_id=$1 AND id=$2 AND student_id=$3 FOR UPDATE",
            [gen, id, studentId],
          )
        ).rows[0];
        if (!row) throw new NotFoundError("Follow-up not found");
        fresh(row.revision, input.expectedRevision);
        previous = row;
        await client.query(
          "UPDATE support_followups SET due_on=$2,note=$3,shared=$4,status=$5,outcome=$6,revision=revision+1,updated_at=now() WHERE id=$1",
          [
            id,
            input.dueOn,
            input.note,
            input.shared,
            input.status,
            input.outcome,
          ],
        );
      } else
        await client.query(
          "INSERT INTO support_followups(id,generation_id,student_id,mentor_person_id,due_on,note,shared,status,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            id,
            gen,
            studentId,
            facultyId,
            input.dueOn,
            input.note,
            input.shared,
            input.status,
            input.outcome,
          ],
        );
      updated = { ...input, studentId };
    } else if (input.action === "record-meeting") {
      // The assigned mentor, or the department head for a student in the department
      // (chapter11/authority.ts); requireExperienceStudent enforces the scope.
      requireRole(actor, "faculty", "hod");
      const { student } = await requireExperienceStudent(client, gen, actor, input.studentId);
      studentId = input.studentId;
      await assertStudentNotFrozen(client, studentId);
      if (!(await meetingTablesPresent(client)))
        throw new ConflictError("MEETINGS_NOT_READY", MEETINGS_NOT_READY);
      if (!input.supportCaseId && !input.supportPlanId)
        throw new ConflictError("REPORT_REQUIRED", "Choose the AI report this meeting was about.");
      // The AI report: its support case once it reached the gate (awaiting a decision,
      // approved or declined), with its approved plan when there is one.
      const report = (
        await client.query<{ id: string; opened_at: Date; plan_id: string | null }>(
          `SELECT c.id,c.opened_at,p.id AS plan_id FROM support_cases c
           LEFT JOIN support_plans p ON p.support_case_id=c.id AND p.generation_id=c.generation_id
           WHERE c.generation_id=$1 AND c.student_id=$2 AND c.status IN ('awaiting_faculty','approved','rejected')
             AND ($3::uuid IS NULL OR c.id=$3::uuid) AND ($4::uuid IS NULL OR p.id=$4::uuid)
           LIMIT 1 FOR UPDATE OF c`,
          [gen, studentId, input.supportCaseId ?? null, input.supportPlanId ?? null],
        )
      ).rows[0];
      if (!report) throw new NotFoundError("AI report not found for this student");
      const reportOn = collegeDate(report.opened_at);
      const meeting = validateMeeting(input, { reportOn });
      // The check-in this meeting completes: the one named, else the case's open
      // check-in, else a new one (dated the day they met) when every earlier one
      // already has its meeting.
      const checkin = (
        await client.query<{ id: string; revision: number; status: string; recorded: boolean }>(
          `SELECT f.*,EXISTS(SELECT 1 FROM support_meetings m WHERE m.followup_id=f.id) AS recorded FROM support_followups f
           WHERE f.generation_id=$1 AND f.student_id=$2
             AND (f.support_case_id=$3 OR f.support_plan_id IN (SELECT cp.id FROM support_plans cp WHERE cp.support_case_id=$3))
             AND ($4::uuid IS NULL OR f.id=$4::uuid)
             AND ($4::uuid IS NOT NULL OR f.status<>'completed') ORDER BY f.due_on LIMIT 1 FOR UPDATE OF f`,
          [gen, studentId, report.id, input.followupId ?? null],
        )
      ).rows[0];
      if (input.followupId && !checkin) throw new NotFoundError("Check-in not found for this AI report");
      if (checkin?.recorded)
        throw new ConflictError("MEETING_ALREADY_RECORDED", "This check-in already has its meeting record.");
      const outcome = meetingOutcome(meeting.metOn);
      let followupId: string;
      if (checkin) {
        followupId = checkin.id;
        previous = checkin;
        await client.query(
          "UPDATE support_followups SET status='completed',outcome=$2,revision=revision+1,updated_at=now() WHERE id=$1",
          [followupId, outcome],
        );
      } else {
        followupId = randomUUID();
        const mentorId = student.mentor_id ?? actor.personId;
        await client.query(
          "INSERT INTO support_followups(id,generation_id,student_id,support_case_id,support_plan_id,mentor_person_id,due_on,note,shared,status,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'completed',$9)",
          [followupId, gen, studentId, report.id, report.plan_id, mentorId, meeting.metOn, reportCheckinNote(reportOn), outcome],
        );
      }
      id = randomUUID();
      await client.query(
        "INSERT INTO support_meetings(id,generation_id,followup_id,support_case_id,support_plan_id,student_id,met_on,reasons,note,agreed_next_step,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11)",
        [id, gen, followupId, report.id, report.plan_id, studentId, meeting.metOn, meeting.reasons, meeting.note, meeting.agreedNextStep, actor.personId],
      );
      resource = "support_meetings";
      facultyId = student.mentor_id ?? undefined;
      updated = {
        studentId,
        supportCaseId: report.id,
        supportPlanId: report.plan_id,
        reportOn,
        followupId,
        metOn: meeting.metOn,
        reasons: meeting.reasons,
        note: meeting.note,
        agreedNextStep: meeting.agreedNextStep,
        followupOutcome: outcome,
        recordedByRole: actor.role,
      };
    } else if (input.action === "send-message") {
      // The department head only, about a student in their department, to that
      // student's mentor, who must be an active mentor in the department.
      requireRole(actor, "hod");
      if (!(await staffMessagesPresent(client)))
        throw new ConflictError("MESSAGES_NOT_READY", STAFF_MESSAGES_NOT_READY);
      const target = await reminderTarget(client, gen, actor, input.supportCaseId);
      studentId = target.studentId;
      await assertStudentNotFrozen(client, studentId);
      await facultyInDepartment(client, gen, actor, target.mentorId);
      const body = messageBody(target.reminder, input.note);
      await client.query(
        "INSERT INTO staff_messages(id,generation_id,from_person_id,to_person_id,student_id,support_case_id,body) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, gen, actor.personId, target.mentorId, studentId, input.supportCaseId, body],
      );
      resource = "staff_messages";
      facultyId = target.mentorId;
      updated = {
        studentId,
        supportCaseId: input.supportCaseId,
        toPersonId: target.mentorId,
        reportOn: target.reportOn,
        body,
      };
    } else if (input.action === "mark-message-read") {
      // Only the mentor the message was sent to marks it read; read_at is set once.
      requireRole(actor, "faculty");
      if (!(await staffMessagesPresent(client)))
        throw new ConflictError("MESSAGES_NOT_READY", STAFF_MESSAGES_NOT_READY);
      const message = (
        await client.query<{ id: string; to_person_id: string; student_id: string; read_at: Date | null }>(
          "SELECT * FROM staff_messages WHERE generation_id=$1 AND id=$2 FOR UPDATE",
          [gen, input.messageId],
        )
      ).rows[0];
      if (!message || message.to_person_id !== actor.personId)
        throw new NotFoundError("Message not found");
      id = message.id;
      previous = message;
      studentId = message.student_id;
      facultyId = actor.personId;
      const readAt =
        message.read_at ??
        (
          await client.query<{ read_at: Date }>(
            "UPDATE staff_messages SET read_at=now() WHERE id=$1 RETURNING read_at",
            [id],
          )
        ).rows[0]!.read_at;
      resource = "staff_messages";
      updated = { messageId: id, readAt: new Date(readAt).toISOString() };
    } else {
      requireRole(actor, "faculty", "hod");
      await requireLmsCourse(client, gen, actor, input.offeringId, true);
      facultyId = actor.role === "faculty" ? actor.personId : undefined;
      const ids =
        input.action === "save-attendance"
          ? input.records.map((r) => r.studentId)
          : input.marks.map((m) => m.studentId);
      if (new Set(ids).size !== ids.length)
        throw new ConflictError("DUPLICATE_STUDENT", "Enter each student once");
      const roster = await client.query(
        "SELECT student_id FROM registrations WHERE generation_id=$1 AND course_offering_id=$2 AND student_id=ANY($3::uuid[]) AND status IN ('registered','completed') FOR UPDATE",
        [gen, input.offeringId, ids],
      );
      if (roster.rowCount !== ids.length)
        throw new ConflictError(
          "ROSTER_MISMATCH",
          "Only enrolled students can receive attendance or marks",
        );
      id = input.id ?? id;
      if (input.action === "save-attendance") {
        const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
        if(input.sessionDate>today)throw new ConflictError("FUTURE_ATTENDANCE","Attendance can only be recorded for today or an earlier date.");
        resource = "attendance_sessions";
        eventType = "attendance.submitted";
        if (input.id) {
          const row = (
            await client.query<{ revision: number; status: string }>(
              "SELECT * FROM attendance_sessions WHERE generation_id=$1 AND id=$2 AND course_offering_id=$3 FOR UPDATE",
              [gen, id, input.offeringId],
            )
          ).rows[0];
          if (!row) throw new NotFoundError("Attendance sheet not found");
          fresh(row.revision, input.expectedRevision);
          if (row.status === "locked" && actor.role !== "hod")
            throw new ConflictError(
              "ATTENDANCE_LOCKED",
              "Ask your HoD to correct this locked sheet",
            );
          previous = {
            ...row,
            records: (
              await client.query(
                "SELECT * FROM attendance_records WHERE attendance_session_id=$1",
                [id],
              )
            ).rows,
          };
          await client.query(
            "UPDATE attendance_sessions SET session_date=$2,topic=$3,status=CASE WHEN status='locked' THEN 'locked' ELSE 'submitted' END,revision=revision+1 WHERE id=$1",
            [id, input.sessionDate, input.topic],
          );
        } else
          await client.query(
            "INSERT INTO attendance_sessions(id,generation_id,course_offering_id,session_date,topic,status) VALUES($1,$2,$3,$4,$5,'submitted')",
            [id, gen, input.offeringId, input.sessionDate, input.topic],
          );
        for (const r of input.records)
          await client.query(
            "INSERT INTO attendance_records(id,generation_id,attendance_session_id,student_id,status,recorded_by_person_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(generation_id,attendance_session_id,student_id) DO UPDATE SET status=$5,recorded_by_person_id=$6,recorded_at=now(),revision=attendance_records.revision+1",
            [randomUUID(), gen, id, r.studentId, r.status, actor.personId],
          );
        updated = { ...input, studentIds: ids };
      } else {
        resource = "assessments";
        eventType = "marks.published";
        if (input.marks.some((m) => m.score > input.maximumScore))
          throw new ConflictError(
            "MARK_RANGE",
            "Marks cannot exceed the maximum",
          );
        if (input.id) {
          const row = (
            await client.query<{ revision: number }>(
              "SELECT * FROM assessments WHERE generation_id=$1 AND id=$2 AND course_offering_id=$3 FOR UPDATE",
              [gen, id, input.offeringId],
            )
          ).rows[0];
          if (!row) throw new NotFoundError("Assessment not found");
          fresh(row.revision, input.expectedRevision);
          previous = {
            ...row,
            marks: (
              await client.query("SELECT * FROM marks WHERE assessment_id=$1", [
                id,
              ])
            ).rows,
          };
          const remaining = await client.query(
            "SELECT id FROM marks WHERE assessment_id=$1 AND NOT(student_id=ANY($2::uuid[])) AND score>$3 LIMIT 1",
            [id, ids, input.maximumScore],
          );
          if (remaining.rowCount)
            throw new ConflictError(
              "MARK_RANGE",
              "Maximum marks cannot be lower than another published score",
            );
          await client.query(
            "UPDATE assessments SET title=$2,maximum_score=$3,weight_percent=$4,published=true,revision=revision+1 WHERE id=$1",
            [id, input.title, input.maximumScore, input.weightPercent],
          );
        } else
          await client.query(
            "INSERT INTO assessments(id,generation_id,course_offering_id,title,category,maximum_score,weight_percent,published) VALUES($1,$2,$3,$4,'internal',$5,$6,true)",
            [
              id,
              gen,
              input.offeringId,
              input.title,
              input.maximumScore,
              input.weightPercent,
            ],
          );
        for (const m of input.marks)
          await client.query(
            "INSERT INTO marks(id,generation_id,assessment_id,student_id,score,feedback,recorded_by_person_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(generation_id,assessment_id,student_id) DO UPDATE SET score=$5,feedback=$6,recorded_by_person_id=$7,recorded_at=now(),revision=marks.revision+1",
            [
              randomUUID(),
              gen,
              id,
              m.studentId,
              m.score,
              m.feedback,
              actor.personId,
            ],
          );
        updated = { ...input, studentIds: ids };
      }
    }
    await recordChange(
      client,
      gen,
      actor,
      resource,
      id,
      "reason" in input
        ? input.reason
        : input.action === "record-meeting"
          ? "Conversation with the student about the AI report recorded"
          : input.action === "send-message"
            ? "Department head asked the mentor about a conversation not submitted"
            : input.action === "mark-message-read"
              ? "Mentor read the message from the department head"
              : "Student submitted the final course selection",
      previous,
      updated,
    );
    const receipt = await writeCommandLedger(client, {
      generationId: gen,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: resource,
      aggregateId: id,
      eventType,
      action: input.action,
      topic: eventType,
      payload: {
        resourceId: id,
        studentId: studentId ?? null,
        facultyPersonId: facultyId ?? null,
        departmentId: actor.departmentId ?? null,
        inputHash,
        ...(["save-attendance", "save-marks"].includes(input.action)
          ? {
              offering: { id: (input as { offeringId: string }).offeringId },
              studentIds: updated.studentIds,
            }
          : {}),
      },
    });
    return { id, duplicate: false, receipt };
  }).catch(error=>{if(error && typeof error==='object' && 'code' in error && error.code==='23505')throw new ConflictError('DUPLICATE_RECORD','A record with these details already exists. Open the existing record to change it.');throw error;});
}
