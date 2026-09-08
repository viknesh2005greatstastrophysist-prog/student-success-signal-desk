import type {
  ActorContext,
  LmsCourse,
  LmsCourseDetail,
  LmsOverview,
  LmsLesson,
  LmsAssignment,
  LmsSubmission,
} from "@aura/contracts";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getCurrentGeneration } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { NotFoundError } from "./http";
import { requireRole } from "./security";
import { digest, sourceSchema, type Source } from "./chapter11/engine";

export async function requireLmsCourse(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
  offeringId: string,
  manage = false,
) {
  z.string().uuid().parse(offeringId);
  requireRole(
    actor,
    ...(manage
      ? (["faculty", "hod"] as const)
      : (["student", "faculty", "hod"] as const)),
  );
  const result = await client.query<{ id: string; department_id: string }>(
    `SELECT o.id,c.department_id FROM course_offerings o JOIN courses c ON c.id=o.course_id
     WHERE o.id=$1 AND o.generation_id=$2 AND (
       ($3='hod' AND c.department_id=$4) OR
       ($3='faculty' AND EXISTS(SELECT 1 FROM faculty_assignments f WHERE f.generation_id=$2 AND f.course_offering_id=o.id AND f.faculty_person_id=$5 AND f.active)) OR
       ($3='student' AND o.status IN ('published','closed') AND EXISTS(SELECT 1 FROM registrations r WHERE r.generation_id=$2 AND r.course_offering_id=o.id AND r.student_id=$6 AND r.status IN ('registered','completed')))
     )`,
    [
      offeringId,
      generation,
      actor.role,
      actor.departmentId ?? null,
      actor.personId,
      actor.studentId ?? null,
    ],
  );
  if (!result.rowCount)
    throw new NotFoundError("This course is not available to your account");
  return result.rows[0]!;
}

async function coursesForActor(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
): Promise<LmsCourse[]> {
  requireRole(actor, "student", "faculty", "hod");
  const rows = await client.query<LmsCourse>(
    `SELECT o.id,c.code,c.title,c.credits,o.section,
      (SELECT r.status FROM registrations r WHERE r.generation_id=$1 AND r.course_offering_id=o.id AND r.student_id=$5) AS registration_status,
      COALESCE((SELECT string_agg(p.display_name,', ' ORDER BY p.display_name) FROM faculty_assignments f JOIN people p ON p.id=f.faculty_person_id WHERE f.generation_id=$1 AND f.course_offering_id=o.id AND f.active),'Faculty assignment pending') AS faculty_name,
      (SELECT count(*)::int FROM lms_lessons l WHERE l.generation_id=$1 AND l.course_offering_id=o.id AND ($2<>'student' OR l.published)) AS lessons,
      (SELECT count(*)::int FROM lms_assignments a WHERE a.generation_id=$1 AND a.course_offering_id=o.id AND ($2<>'student' OR a.published)) AS assignments,
      (SELECT count(*)::int FROM lms_assignments a WHERE a.generation_id=$1 AND a.course_offering_id=o.id AND a.published
        AND CASE WHEN $2='student' THEN EXISTS(SELECT 1 FROM registrations r WHERE r.generation_id=$1 AND r.course_offering_id=o.id AND r.student_id=$5 AND r.status='registered') AND NOT EXISTS(SELECT 1 FROM lms_submissions s WHERE s.assignment_id=a.id AND s.student_id=$5)
        ELSE EXISTS(SELECT 1 FROM lms_submissions s WHERE s.assignment_id=a.id AND s.graded_at IS NULL) END) AS pending
     FROM course_offerings o JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id
     WHERE o.generation_id=$1 AND t.active AND (
       ($2='hod' AND c.department_id=$3) OR
       ($2='faculty' AND EXISTS(SELECT 1 FROM faculty_assignments f WHERE f.generation_id=$1 AND f.course_offering_id=o.id AND f.faculty_person_id=$4 AND f.active)) OR
       ($2='student' AND o.status IN ('published','closed') AND EXISTS(SELECT 1 FROM registrations r WHERE r.generation_id=$1 AND r.course_offering_id=o.id AND r.student_id=$5 AND r.status IN ('registered','completed'))))
     ORDER BY c.code,o.section`,
    [
      generation,
      actor.role,
      actor.departmentId ?? null,
      actor.personId,
      actor.studentId ?? null,
    ],
  );
  return rows.rows;
}

export async function lmsOverview(actor: ActorContext): Promise<LmsOverview> {
  return withCoreTransaction(async (client) => {
    const courses = await coursesForActor(
      client,
      await getCurrentGeneration(client),
      actor,
    );
    const person = await client.query<{ display_name: string }>(
      "SELECT display_name FROM people WHERE id=$1",
      [actor.personId],
    );
    return {
      role: actor.role as LmsOverview["role"],
      name: person.rows[0]!.display_name,
      courses,
    };
  });
}

export async function lmsCourseDetail(
  actor: ActorContext,
  offeringId: string,
): Promise<LmsCourseDetail> {
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    await requireLmsCourse(client, generation, actor, offeringId);
    const course = (await coursesForActor(client, generation, actor)).find(
      (c) => c.id === offeringId,
    );
    if (!course)
      throw new NotFoundError("Course not found in the current semester");
    const lessons = await client.query<LmsLesson>(
      `SELECT l.id,l.title,l.body,l.material_url,l.attachment->>'name' AS attachment_name,l.published,l.position,l.revision,
        (SELECT max(a.occurred_at)::text FROM lms_activity a WHERE a.generation_id=$1 AND a.resource_id=l.id AND a.student_id=$4) AS opened_at
       FROM lms_lessons l WHERE l.generation_id=$1 AND l.course_offering_id=$2 AND ($3<>'student' OR l.published) ORDER BY l.position,l.created_at`,
      [generation, offeringId, actor.role, actor.studentId ?? null],
    );
    const assignments = await client.query<LmsAssignment>(
      `SELECT a.id,a.title,a.instructions,a.due_at::text,a.maximum_score::text,a.attachment->>'name' AS attachment_name,a.published,a.allow_late,(a.due_at < now()) AS deadline_passed,a.revision,
        (SELECT count(*)::int FROM lms_submissions s WHERE s.assignment_id=a.id AND ($3<>'student' OR s.student_id=$4)) AS submissions
       FROM lms_assignments a WHERE a.generation_id=$1 AND a.course_offering_id=$2 AND ($3<>'student' OR a.published) ORDER BY a.due_at,a.created_at`,
      [generation, offeringId, actor.role, actor.studentId ?? null],
    );
    const submissions = await client.query<LmsSubmission>(
      `SELECT s.id,s.assignment_id,s.student_id,p.display_name AS student_name,s.answer,s.attachment->>'name' AS attachment_name,
        s.submitted_at::text,s.revision,s.score::text,s.feedback,s.graded_at::text
       FROM lms_submissions s JOIN lms_assignments a ON a.id=s.assignment_id JOIN student_profiles sp ON sp.id=s.student_id JOIN people p ON p.id=sp.person_id
       WHERE s.generation_id=$1 AND a.course_offering_id=$2 AND ($3<>'student' OR (a.published AND s.student_id=$4)) ORDER BY s.submitted_at DESC`,
      [generation, offeringId, actor.role, actor.studentId ?? null],
    );
    return {
      course,
      lessons: lessons.rows,
      assignments: assignments.rows,
      submissions: submissions.rows,
      canManage: actor.role !== "student",
    };
  });
}

export async function readLmsAttachment(
  actor: ActorContext,
  kind: string,
  id: string,
) {
  z.string().uuid().parse(id);
  const table = (
    {
      lessons: "lms_lessons",
      assignments: "lms_assignments",
      submissions: "lms_submissions",
    } as Record<string, string>
  )[kind];
  if (!table) throw new NotFoundError("File not found");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const result = await client.query<{
      attachment: { name: string; data: string } | null;
      course_offering_id: string;
      published: boolean;
      student_id?: string;
    }>(
      kind === "submissions"
        ? `SELECT s.attachment,a.course_offering_id,a.published,s.student_id FROM lms_submissions s JOIN lms_assignments a ON a.id=s.assignment_id WHERE s.generation_id=$1 AND s.id=$2`
        : `SELECT attachment,course_offering_id,published FROM ${table} WHERE generation_id=$1 AND id=$2`,
      [generation, id],
    );
    const row = result.rows[0];
    if (!row?.attachment) throw new NotFoundError("File not found");
    await requireLmsCourse(client, generation, actor, row.course_offering_id);
    if (
      actor.role === "student" &&
      (!row.published ||
        (kind === "submissions" && row.student_id !== actor.studentId))
    )
      throw new NotFoundError("File not found");
    return row.attachment;
  });
}

/** Computed at collection time: raw student work never enters the agent prompt. */
export async function lmsEvidence(
  client: PoolClient,
  generation: string,
  studentId: string,
): Promise<Source> {
  const rows = await client.query<{
    id: string;
    registered_at: Date;
    term: string;
    last_activity: Date | null;
  }>(
    `SELECT r.course_offering_id AS id,r.registered_at,t.code AS term,
      (SELECT max(a.occurred_at) FROM lms_activity a WHERE a.generation_id=$1 AND a.student_id=$2 AND a.course_offering_id=r.course_offering_id) AS last_activity
     FROM registrations r JOIN course_offerings o ON o.id=r.course_offering_id JOIN terms t ON t.id=o.term_id
     WHERE r.generation_id=$1 AND r.student_id=$2 AND r.status='registered' AND t.active`,
    [generation, studentId],
  );
  const now = new Date();
  const due = await client.query<{ id: string; due_at: Date }>(
    `SELECT a.id,a.due_at FROM lms_assignments a JOIN registrations r ON r.course_offering_id=a.course_offering_id AND r.student_id=$2 AND r.status='registered'
     JOIN course_offerings o ON o.id=a.course_offering_id JOIN terms t ON t.id=o.term_id
     WHERE a.generation_id=$1 AND r.generation_id=$1 AND t.active AND a.published AND a.due_at < $3
       AND a.due_at >= r.registered_at AND NOT EXISTS(SELECT 1 FROM lms_submissions s WHERE s.assignment_id=a.id AND s.student_id=$2)`,
    [generation, studentId, now],
  );
  const last = rows.rows.reduce(
    (latest, row) =>
      Math.max(latest, (row.last_activity ?? row.registered_at).getTime()),
    0,
  );
  const values = {
    inactivityDays: last
      ? Math.max(0, Math.floor((now.getTime() - last) / 86400000))
      : 0,
    overdueAssignments: due.rowCount ?? 0,
    registeredCourses: rows.rows.length,
    neverActive:
      rows.rows.length > 0 && rows.rows.every((r) => !r.last_activity),
    activityMeaning:
      "Lesson access or assignment submission; access alone does not prove learning",
    overdueAssignmentIds: due.rows.map((r) => r.id).join(","),
  };
  return sourceSchema.parse({
    source: "lms",
    studentId,
    recordId: `LMS-${digest({ studentId, values, last })}`,
    observedAt: now.toISOString(),
    semester: rows.rows[0]?.term ?? "2026-ODD",
    state: rows.rows.length ? "present" : "missing",
    synthetic: true,
    values,
  });
}
