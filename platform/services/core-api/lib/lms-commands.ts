import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import {
  assertCommandId,
  findDuplicateCommand,
  getCurrentGeneration,
  writeCommandLedger,
} from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole } from "./security";
import { requireLmsCourse } from "./lms-queries";
import { digest } from "./chapter11/engine";

const fileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[\p{L}\p{N} ._()\-]+$/u,
        "Use a simple file name without folder paths",
      ),
    data: z
      .string()
      .max(2_800_000)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        "The file could not be read",
      ),
  })
  .strict()
  .refine(
    (file) =>
      Buffer.from(file.data, "base64").length > 0 &&
      Buffer.from(file.data, "base64").length <= 2 * 1024 * 1024,
    "Files must be between 1 byte and 2 MB",
  );
const editable = {
  id: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
};
const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => !v || (/^https?:\/\//i.test(v) && URL.canParse(v)),
    "Use a complete http or https link",
  );
export const lmsCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save-lesson"),
      offeringId: z.string().uuid(),
      ...editable,
      title: z.string().trim().min(3).max(160),
      body: z.string().max(40000),
      materialUrl: urlSchema.default(""),
      attachment: fileSchema.optional(),
      published: z.boolean(),
      position: z.number().int().min(1).max(1000).default(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("save-assignment"),
      offeringId: z.string().uuid(),
      ...editable,
      title: z.string().trim().min(3).max(160),
      instructions: z.string().trim().min(5).max(40000),
      dueAt: z.string().datetime({ offset: true }),
      maximumScore: z.number().positive().max(1000),
      attachment: fileSchema.optional(),
      published: z.boolean(),
      allowLate: z.boolean().default(true),
    })
    .strict(),
  z
    .object({ action: z.literal("open-lesson"), lessonId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("submit-assignment"),
      assignmentId: z.string().uuid(),
      expectedRevision: z.number().int().min(-1),
      answer: z.string().trim().max(40000),
      attachment: fileSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("publish-feedback"),
      submissionId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
      score: z.number().nonnegative(),
      feedback: z.string().trim().min(3).max(12000),
    })
    .strict(),
]);

export async function lmsCommand(
  actor: ActorContext,
  commandId: string,
  raw: unknown,
) {
  assertCommandId(commandId);
  const input = lmsCommandSchema.parse(raw);
  requireRole(actor, "student", "faculty", "hod");
  const inputHash = digest(input);
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(
      client,
      generation,
      commandId,
      actor.personId,
    );
    if (duplicate) {
      if (duplicate.payload.inputHash !== inputHash)
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "This request identifier was already used for different work",
        );
      return {
        id: duplicate.payload.resourceId,
        revision: duplicate.payload.revision,
        duplicate: true,
        receipt: duplicate.receipt,
      };
    }
    let resourceId: string;
    let revision = 0;
    let offeringId: string;
    let table: string;
    let studentId = actor.studentId;
    let eventType: string;
    if (input.action === "save-lesson" || input.action === "save-assignment") {
      offeringId = input.offeringId;
      await requireLmsCourse(client, generation, actor, offeringId, true);
      table =
        input.action === "save-lesson" ? "lms_lessons" : "lms_assignments";
      resourceId = input.id ?? randomUUID();
      if (input.id) {
        const prior = await client.query<{ revision: number }>(
          `SELECT revision FROM ${table} WHERE generation_id=$1 AND id=$2 AND course_offering_id=$3 FOR UPDATE`,
          [generation, resourceId, offeringId],
        );
        if (!prior.rowCount) throw new NotFoundError("Course item not found");
        if (prior.rows[0]!.revision !== input.expectedRevision)
          throw new ConflictError(
            "STALE_VERSION",
            "This item changed. Reload it before saving again.",
          );
        revision = prior.rows[0]!.revision + 1;
      }
      if (input.action === "save-lesson") {
        if (input.id)
          await client.query(
            "UPDATE lms_lessons SET title=$3,body=$4,material_url=$5,attachment=COALESCE($6::jsonb,attachment),published=$7,position=$8,revision=$9,updated_at=now() WHERE generation_id=$1 AND id=$2",
            [
              generation,
              resourceId,
              input.title,
              input.body,
              input.materialUrl,
              input.attachment ? JSON.stringify(input.attachment) : null,
              input.published,
              input.position,
              revision,
            ],
          );
        else
          await client.query(
            "INSERT INTO lms_lessons(id,generation_id,course_offering_id,title,body,material_url,attachment,published,position,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",
            [
              resourceId,
              generation,
              offeringId,
              input.title,
              input.body,
              input.materialUrl,
              input.attachment ? JSON.stringify(input.attachment) : null,
              input.published,
              input.position,
              actor.personId,
            ],
          );
        eventType = input.published
          ? "lms.lesson_published"
          : "lms.lesson_saved";
      } else {
        const maximum = await client.query<{ score: string | null }>(
          "SELECT max(score)::text AS score FROM lms_submissions WHERE assignment_id=$1",
          [resourceId],
        );
        if (
          maximum.rows[0]?.score &&
          Number(maximum.rows[0].score) > input.maximumScore
        )
          throw new ConflictError(
            "SCORE_RANGE",
            "Maximum marks cannot be lower than an already published score",
          );
        if (input.id)
          await client.query(
            "UPDATE lms_assignments SET title=$3,instructions=$4,due_at=$5,maximum_score=$6,attachment=COALESCE($7::jsonb,attachment),published=$8,allow_late=$9,revision=$10,updated_at=now() WHERE generation_id=$1 AND id=$2",
            [
              generation,
              resourceId,
              input.title,
              input.instructions,
              input.dueAt,
              input.maximumScore,
              input.attachment ? JSON.stringify(input.attachment) : null,
              input.published,
              input.allowLate,
              revision,
            ],
          );
        else
          await client.query(
            "INSERT INTO lms_assignments(id,generation_id,course_offering_id,title,instructions,due_at,maximum_score,attachment,published,allow_late,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)",
            [
              resourceId,
              generation,
              offeringId,
              input.title,
              input.instructions,
              input.dueAt,
              input.maximumScore,
              input.attachment ? JSON.stringify(input.attachment) : null,
              input.published,
              input.allowLate,
              actor.personId,
            ],
          );
        eventType = input.published
          ? "lms.assignment_published"
          : "lms.assignment_saved";
      }
    } else if (input.action === "open-lesson") {
      requireRole(actor, "student");
      const lesson = await client.query<{ course_offering_id: string }>(
        "SELECT course_offering_id FROM lms_lessons WHERE generation_id=$1 AND id=$2 AND published",
        [generation, input.lessonId],
      );
      if (!lesson.rowCount) throw new NotFoundError("Lesson not found");
      offeringId = lesson.rows[0]!.course_offering_id;
      await requireLmsCourse(client, generation, actor, offeringId);
      resourceId = input.lessonId;
      table = "lms_activity";
      eventType = "lms.lesson_opened";
      await client.query(
        "INSERT INTO lms_activity(id,generation_id,student_id,course_offering_id,resource_id,kind) VALUES($1,$2,$3,$4,$5,'lesson_opened')",
        [randomUUID(), generation, actor.studentId, offeringId, resourceId],
      );
    } else if (input.action === "submit-assignment") {
      requireRole(actor, "student");
      if (!input.answer && !input.attachment)
        throw new ConflictError(
          "EMPTY_SUBMISSION",
          "Add your answer or attach a file before submitting",
        );
      const assignment = await client.query<{
        course_offering_id: string;
        due_at: Date;
        allow_late: boolean;
      }>(
        "SELECT course_offering_id,due_at,allow_late FROM lms_assignments WHERE generation_id=$1 AND id=$2 AND published FOR UPDATE",
        [generation, input.assignmentId],
      );
      if (!assignment.rowCount) throw new NotFoundError("Assignment not found");
      const item = assignment.rows[0]!;
      offeringId = item.course_offering_id;
      await requireLmsCourse(client, generation, actor, offeringId);
      const registration = await client.query(
        "SELECT id FROM registrations WHERE generation_id=$1 AND student_id=$2 AND course_offering_id=$3 AND status='registered'",
        [generation, actor.studentId, offeringId],
      );
      if (!registration.rowCount)
        throw new ConflictError(
          "COURSE_FINISHED",
          "Submissions are closed for a completed course",
        );
      if (!item.allow_late && item.due_at.getTime() < Date.now())
        throw new ConflictError(
          "DEADLINE_PASSED",
          "The submission deadline has passed. Contact your faculty member.",
        );
      const prior = await client.query<{
        id: string;
        revision: number;
        graded_at: Date | null;
      }>(
        "SELECT id,revision,graded_at FROM lms_submissions WHERE generation_id=$1 AND assignment_id=$2 AND student_id=$3 FOR UPDATE",
        [generation, input.assignmentId, actor.studentId],
      );
      if ((prior.rows[0]?.revision ?? -1) !== input.expectedRevision)
        throw new ConflictError(
          "STALE_VERSION",
          "Your submission changed. Reload it before submitting again.",
        );
      if (prior.rows[0]?.graded_at)
        throw new ConflictError(
          "ALREADY_REVIEWED",
          "Feedback has been published. Contact your faculty member before replacing this work.",
        );
      resourceId = prior.rows[0]?.id ?? randomUUID();
      revision = prior.rows[0] ? prior.rows[0].revision + 1 : 0;
      table = "lms_submissions";
      eventType = "lms.assignment_submitted";
      if (prior.rowCount)
        await client.query(
          "UPDATE lms_submissions SET answer=$3,attachment=$4::jsonb,submitted_at=now(),revision=$5 WHERE generation_id=$1 AND id=$2",
          [
            generation,
            resourceId,
            input.answer,
            input.attachment ? JSON.stringify(input.attachment) : null,
            revision,
          ],
        );
      else
        await client.query(
          "INSERT INTO lms_submissions(id,generation_id,assignment_id,student_id,answer,attachment) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
          [
            resourceId,
            generation,
            input.assignmentId,
            actor.studentId,
            input.answer,
            input.attachment ? JSON.stringify(input.attachment) : null,
          ],
        );
      await client.query(
        "INSERT INTO lms_activity(id,generation_id,student_id,course_offering_id,resource_id,kind) VALUES($1,$2,$3,$4,$5,'assignment_submitted')",
        [randomUUID(), generation, actor.studentId, offeringId, resourceId],
      );
    } else {
      const submission = await client.query<{
        course_offering_id: string;
        maximum_score: string;
        revision: number;
        student_id: string;
      }>(
        "SELECT a.course_offering_id,a.maximum_score,s.revision,s.student_id FROM lms_submissions s JOIN lms_assignments a ON a.id=s.assignment_id WHERE s.generation_id=$1 AND s.id=$2 FOR UPDATE OF a,s",
        [generation, input.submissionId],
      );
      if (!submission.rowCount) throw new NotFoundError("Submission not found");
      const item = submission.rows[0]!;
      offeringId = item.course_offering_id;
      studentId = item.student_id;
      await requireLmsCourse(client, generation, actor, offeringId, true);
      if (item.revision !== input.expectedRevision)
        throw new ConflictError(
          "STALE_VERSION",
          "The submission changed. Read the latest version before publishing feedback.",
        );
      if (input.score > Number(item.maximum_score))
        throw new ConflictError(
          "SCORE_RANGE",
          `Marks must be between 0 and ${item.maximum_score}`,
        );
      resourceId = input.submissionId;
      revision = item.revision + 1;
      table = "lms_submissions";
      eventType = "lms.feedback_published";
      await client.query(
        "UPDATE lms_submissions SET score=$3,feedback=$4,graded_by=$5,graded_at=now(),revision=$6 WHERE generation_id=$1 AND id=$2",
        [
          generation,
          resourceId,
          input.score,
          input.feedback,
          actor.personId,
          revision,
        ],
      );
    }
    const course = await client.query<{ department_id: string }>(
      "SELECT c.department_id FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=$1",
      [offeringId],
    );
    if (table !== "lms_activity")
      await client.query(
        `INSERT INTO lms_versions(id,generation_id,resource_type,resource_id,revision,record,actor_id) SELECT $1,$2,$3,$4,$5,to_jsonb(r),$6 FROM ${table} r WHERE id=$4`,
        [randomUUID(), generation, table, resourceId, revision, actor.personId],
      );
    const receipt = await writeCommandLedger(client, {
      generationId: generation,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "lms",
      aggregateId: resourceId,
      eventType,
      action: input.action,
      topic: "lms.changed",
      payload: {
        resourceId,
        revision,
        offeringId,
        studentId: studentId ?? null,
        departmentId: course.rows[0]!.department_id,
        facultyPersonId: actor.role === "faculty" ? actor.personId : null,
        inputHash,
      },
    });
    return { id: resourceId, revision, duplicate: false, receipt };
  });
}
