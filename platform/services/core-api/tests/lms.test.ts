import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { lmsCommand, lmsCommandSchema } from "../lib/lms-commands";
import {
  lmsOverview,
  lmsCourseDetail,
  readLmsAttachment,
} from "../lib/lms-queries";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { readSource } from "../lib/chapter11/service";

test("LMS input rejects executable links, oversized files and invalid scores", () => {
  const lesson = {
    action: "save-lesson",
    offeringId: randomUUID(),
    title: "Course notes",
    body: "Read these notes",
    published: true,
  };
  assert.equal(
    lmsCommandSchema.safeParse({
      ...lesson,
      materialUrl: "javascript:alert(1)",
    }).success,
    false,
  );
  assert.equal(
    lmsCommandSchema.safeParse({
      ...lesson,
      attachment: { name: "../outside.txt", data: "aGVsbG8=" },
    }).success,
    false,
  );
  assert.equal(
    lmsCommandSchema.safeParse({
      ...lesson,
      attachment: {
        name: "notes.txt",
        data: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
      },
    }).success,
    false,
  );
  assert.equal(
    lmsCommandSchema.safeParse({
      action: "publish-feedback",
      submissionId: randomUUID(),
      expectedRevision: 0,
      score: -1,
      feedback: "Review this",
    }).success,
    false,
  );
});

test(
  "LMS durable course, lesson, submission, feedback and real activity evidence",
  { skip: process.env.RUN_LMS_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_lms/);
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "lms-isolated-test");
      const { student, faculty, otherFaculty, parent, offeringId } =
        await withCoreTransaction(async (client) => {
          const generation = await getCurrentGeneration(client);
          const rows = await client.query<{
            id: string;
            email: string;
            role: ActorContext["role"];
            department_id: string;
            student_id: string | null;
          }>(
            "SELECT p.id,p.email,r.role,r.department_id,s.id AS student_id FROM people p JOIN role_assignments r ON r.person_id=p.id LEFT JOIN student_profiles s ON s.person_id=p.id WHERE p.generation_id=$1",
            [generation],
          );
          const make = (email: string): ActorContext => {
            const p = rows.rows.find((p) => p.email === email)!;
            return {
              subject: email,
              personId: p.id,
              role: p.role,
              departmentId: p.department_id,
              studentId: p.student_id ?? undefined,
            };
          };
          const student = make("student1@aura.invalid");
          const course = await client.query<{ id: string; email: string }>(
            "SELECT o.id,p.email FROM course_offerings o JOIN courses c ON c.id=o.course_id JOIN faculty_assignments f ON f.course_offering_id=o.id AND f.active JOIN people p ON p.id=f.faculty_person_id WHERE o.generation_id=$1 AND c.department_id=$2 AND o.status='published' ORDER BY o.id LIMIT 1",
            [generation, student.departmentId],
          );
          assert.equal(course.rowCount, 1);
          await client.query(
            "INSERT INTO registrations(id,generation_id,student_id,course_offering_id,status) VALUES($1,$2,$3,$4,'registered') ON CONFLICT(generation_id,student_id,course_offering_id) DO UPDATE SET status='registered'",
            [randomUUID(), generation, student.studentId, course.rows[0]!.id],
          );
          await client.query(
            "UPDATE registrations SET registered_at=now()-interval '14 days' WHERE generation_id=$1 AND student_id=$2",
            [generation, student.studentId],
          );
          await client.query(
            "UPDATE mentor_assignments SET faculty_person_id=$2 WHERE student_id=$1",
            [student.studentId, make(course.rows[0]!.email).personId],
          );
          return {
            student,
            faculty: make(course.rows[0]!.email),
            otherFaculty: make("faculty4@aura.invalid"),
            parent: make("parent1@aura.invalid"),
            offeringId: course.rows[0]!.id,
          };
        });
      const overview = await lmsOverview(student);
      assert.ok(overview.courses.some((c) => c.id === offeringId));
      await assert.rejects(() => lmsOverview(parent), /not permitted/);
      const lessonInput = {
        action: "save-lesson",
        offeringId,
        title: "Relational algebra",
        body: "Projection chooses columns. Selection filters rows.",
        published: false,
        attachment: {
          name: "lesson.txt",
          data: Buffer.from("Private course notes").toString("base64"),
        },
      };
      const lesson = await lmsCommand(faculty, randomUUID(), lessonInput);
      assert.equal(
        (await lmsCourseDetail(student, offeringId)).lessons.length,
        0,
      );
      await assert.rejects(
        () => readLmsAttachment(student, "lessons", String(lesson.id)),
        /not found/,
      );
      await lmsCommand(faculty, randomUUID(), {
        ...lessonInput,
        id: lesson.id,
        expectedRevision: 0,
        published: true,
      });
      assert.equal(
        (await readLmsAttachment(student, "lessons", String(lesson.id))).name,
        "lesson.txt",
      );
      await assert.rejects(
        () => lmsCommand(otherFaculty, randomUUID(), lessonInput),
        /not available/,
      );
      const assignment = await lmsCommand(faculty, randomUUID(), {
        action: "save-assignment",
        offeringId,
        title: "Explain selection",
        instructions: "Explain selection using your own example.",
        dueAt: new Date(Date.now() - 86400000).toISOString(),
        maximumScore: 20,
        published: true,
        allowLate: true,
      });
      const before = await readSource(faculty, student.studentId!, "lms");
      assert.equal(before.values.overdueAssignments, 1);
      assert.equal(before.values.neverActive, true);
      await lmsCommand(student, randomUUID(), {
        action: "open-lesson",
        lessonId: lesson.id,
      });
      const submit = {
        action: "submit-assignment",
        assignmentId: assignment.id,
        expectedRevision: -1,
        answer: "PRIVATE ANSWER: selection keeps matching rows",
        attachment: {
          name: "answer.txt",
          data: Buffer.from("My submission").toString("base64"),
        },
      };
      const key = randomUUID();
      const submission = await lmsCommand(student, key, submit);
      assert.equal((await lmsCommand(student, key, submit)).duplicate, true);
      await assert.rejects(
        () => lmsCommand(student, key, { ...submit, answer: "Changed" }),
        /different work/,
      );
      const after = await readSource(faculty, student.studentId!, "lms");
      assert.equal(after.values.overdueAssignments, 0);
      assert.equal(after.values.inactivityDays, 0);
      assert.equal(after.values.neverActive, false);
      assert.ok(!JSON.stringify(after).includes("PRIVATE ANSWER"));
      await assert.rejects(
        () =>
          lmsCommand(student, randomUUID(), {
            action: "publish-feedback",
            submissionId: submission.id,
            expectedRevision: 0,
            score: 19,
            feedback: "Looks correct",
          }),
        /not permitted/,
      );
      await assert.rejects(
        () =>
          lmsCommand(faculty, randomUUID(), {
            action: "publish-feedback",
            submissionId: submission.id,
            expectedRevision: 0,
            score: 21,
            feedback: "Too many marks",
          }),
        /between 0 and 20/,
      );
      const revised = await lmsCommand(student, randomUUID(), {
        ...submit,
        expectedRevision: 0,
        answer: "Revised answer: rows matching the predicate",
      });
      await assert.rejects(
        () =>
          lmsCommand(faculty, randomUUID(), {
            action: "publish-feedback",
            submissionId: submission.id,
            expectedRevision: 0,
            score: 18,
            feedback: "Stale feedback",
          }),
        /latest version/,
      );
      await lmsCommand(faculty, randomUUID(), {
        action: "publish-feedback",
        submissionId: submission.id,
        expectedRevision: revised.revision,
        score: 18,
        feedback: "Correct explanation. Add an example query.",
      });
      const detail = await lmsCourseDetail(student, offeringId);
      assert.equal(Number(detail.submissions[0]!.score), 18);
      assert.match(detail.submissions[0]!.feedback, /example query/);
      await assert.rejects(
        () =>
          lmsCommand(student, randomUUID(), { ...submit, expectedRevision: 2 }),
        /Feedback has been published/,
      );
      assert.equal(
        (await readLmsAttachment(faculty, "submissions", String(submission.id)))
          .name,
        "answer.txt",
      );
      const versions = await withCoreTransaction(
        async (c) =>
          (
            await c.query(
              "SELECT revision FROM lms_versions WHERE resource_id=$1 ORDER BY revision",
              [submission.id],
            )
          ).rows,
      );
      assert.deepEqual(
        versions.map((v) => v.revision),
        [0, 1, 2],
      );
      await closePool();
      assert.equal(
        Number(
          (await lmsCourseDetail(student, offeringId)).submissions[0]!.score,
        ),
        18,
      );
    } finally {
      await closePool();
    }
  },
);
