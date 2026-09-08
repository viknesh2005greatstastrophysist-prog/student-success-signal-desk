import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext, CourseProgress } from "@aura/contracts";
import {
  experienceCommand,
  experienceCommandSchema,
} from "../lib/experience-commands";
import {
  experienceOverview,
  experienceStudent,
  experienceClassroom,
  calculateGpa,
} from "../lib/experience-queries";
import {
  registerForOffering,
  withdrawRegistration,
} from "../lib/registration-commands";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";

test("GPA is credit weighted and ignores unpublished results", () => {
  const base = {
    term_id: "term",
    term_name: "Semester",
    result_published: true,
  } as CourseProgress;
  const gpa = calculateGpa([
    { ...base, credits: 4, grade_point: 8 },
    { ...base, credits: 2, grade_point: 10 },
    { ...base, credits: 8, grade_point: 2, result_published: false },
  ]);
  assert.equal(gpa.cgpa, 8.67);
  assert.equal(gpa.terms[0]!.graded_courses, 2);
  assert.equal(gpa.terms[0]!.registered_courses, 3);
  assert.equal(calculateGpa([]).cgpa, null);
  assert.equal(
    experienceCommandSchema.safeParse({
      action: "save-followup",
      studentId: randomUUID(),
      dueOn: "2026-02-31",
      note: "Discuss learning",
      shared: false,
      status: "planned",
      outcome: "",
      reason: "Initial follow-up",
    }).success,
    false,
  );
});
test(
  "Six-portal registration, mentor scope, academic corrections, shared results and history",
  { skip: process.env.RUN_EXPERIENCE_DB_TESTS !== "1", timeout: 240000 },
  async () => {
    assert.match(
      process.env.CORE_DATABASE_SCHEMA ?? "",
      /^aura_core_test_experience/,
    );
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed(
        "AURA-SYNTHETIC-SEED-V1",
        "experience-integration",
      );
      const actors = await withCoreTransaction(async (c) => {
        const gen = await getCurrentGeneration(c);
        return (
          await c.query<{
            id: string;
            email: string;
            role: ActorContext["role"];
            department_id: string;
            student_id: string | null;
          }>(
            `SELECT p.id,p.email,r.role,r.department_id,s.id AS student_id FROM people p JOIN role_assignments r ON r.person_id=p.id LEFT JOIN student_profiles s ON s.person_id=p.id WHERE p.generation_id=$1`,
            [gen],
          )
        ).rows;
      });
      const who = (email: string): ActorContext => {
        const a = actors.find((a) => a.email === email)!;
        assert.ok(a, email);
        return {
          subject: email,
          personId: a.id,
          role: a.role,
          departmentId: a.department_id,
          studentId: a.student_id ?? undefined,
        };
      };
      const student = who("student1@aura.invalid"),
        parent = who("parent1@aura.invalid"),
        faculty = who("faculty1@aura.invalid"),
        otherFaculty = who("faculty2@aura.invalid"),
        hod = who("hod.cse@aura.invalid"),
        otherHod = who("hod.ece@aura.invalid");
      let o = await experienceOverview(hod);
      assert.equal(o.students.length, 10);
      assert.ok(o.faculty.length > 0);
      const course = o.courses.find((c) => c.code === "CS401")!;
      const saveCourse = {
        action: "save-course",
        id: course.id,
        expectedRevision: course.revision,
        termId: course.term_id,
        code: course.code,
        title: course.title,
        description: course.description,
        credits: course.credits,
        section: course.section,
        capacity: course.capacity,
        status: "published",
        facultyId: faculty.personId,
        slots: [
          { weekday: 3, startsAt: "13:00", endsAt: "14:00", room: "LAB-TEST" },
        ],
        reason: "Publish the course with a clear timetable",
      };
      await assert.rejects(
        () => experienceCommand(otherHod, randomUUID(), saveCourse),
        /department/,
      );
      await experienceCommand(hod, randomUUID(), saveCourse);
      const submit = {
        action: "submit-registration",
        termId: course.term_id,
        offeringIds: [course.id],
        expectedRevision: -1,
      };
      const command = randomUUID();
      await experienceCommand(student, command, submit);
      assert.equal(
        (await experienceCommand(student, command, submit)).duplicate,
        true,
      );
      await assert.rejects(
        () => experienceCommand(student, randomUUID(), submit),
        /submitted/,
      );
      const registered = (await experienceOverview(student)).courses.find(
        (c) => c.id === course.id,
      )!;
      assert.equal(registered.registration_status, "registered");
      await assert.rejects(
        () =>
          withdrawRegistration(
            student,
            registered.registration_id!,
            randomUUID(),
          ),
        /submitted/,
      );
      await assert.rejects(
        () =>
          registerForOffering(student, randomUUID(), { offeringId: course.id }),
        /submitted/,
      );
      const registration = (await experienceOverview(student)).registration[0]!;
      await experienceCommand(hod, randomUUID(), {
        action: "reopen-registration",
        studentId: student.studentId,
        termId: course.term_id,
        expectedRevision: registration.revision,
        reason: "Correct the selected courses",
      });
      const clashing = o.courses.find((c) => c.code === "CS402")!;
      await experienceCommand(hod, randomUUID(), {
        ...saveCourse,
        expectedRevision: 1,
        slots: [
          {
            weekday: 1,
            startsAt: "09:00",
            endsAt: "10:00",
            room: "LAB-NO-ROOM-CLASH",
          },
        ],
      });
      await assert.rejects(
        () =>
          experienceCommand(student, randomUUID(), {
            ...submit,
            offeringIds: [course.id, clashing.id],
            expectedRevision: 1,
          }),
        /overlaps/,
      );
      assert.equal(
        (await experienceOverview(student)).courses.find(
          (c) => c.id === clashing.id,
        )!.registration_status,
        null,
      );
      await experienceCommand(student, randomUUID(), {
        ...submit,
        expectedRevision: 1,
      });
      await assert.rejects(
        () => experienceStudent(otherFaculty, student.studentId!),
        /outside/,
      );
      const mentor = (await experienceOverview(hod)).students.find(
        (s) => s.id === student.studentId,
      )!;
      await experienceCommand(hod, randomUUID(), {
        action: "assign-mentor",
        studentId: student.studentId,
        facultyId: otherFaculty.personId,
        expectedRevision: mentor.mentor_revision,
        reason: "Redistribute the mentoring workload",
      });
      await assert.rejects(
        () => experienceStudent(faculty, student.studentId!),
        /outside/,
      );
      assert.equal(
        (await experienceStudent(otherFaculty, student.studentId!)).student
          .mentor_id,
        otherFaculty.personId,
      );
      // Teaching rights survive a mentor change; full profile access does not.
      assert.equal(
        (await experienceClassroom(faculty, course.id)).roster.length,
        1,
      );
      const follow = await experienceCommand(otherFaculty, randomUUID(), {
        action: "save-followup",
        studentId: student.studentId,
        dueOn: "2026-09-12",
        note: "Review the study plan together",
        shared: false,
        status: "planned",
        outcome: "",
        reason: "Schedule the first mentor meeting",
      });
      assert.equal(
        (await experienceStudent(parent, student.studentId!)).followups.length,
        0,
      );
      await experienceCommand(otherFaculty, randomUUID(), {
        action: "save-followup",
        id: follow.id,
        expectedRevision: 0,
        studentId: student.studentId,
        dueOn: "2026-09-12",
        note: "Review the study plan together",
        shared: true,
        status: "planned",
        outcome: "",
        reason: "Share meeting details with student and parent",
      });
      assert.equal(
        (await experienceStudent(parent, student.studentId!)).followups.length,
        1,
      );
      await assert.rejects(()=>experienceCommand(faculty,randomUUID(),{action:"save-attendance",offeringId:course.id,sessionDate:new Date(Date.now()+86400000).toISOString().slice(0,10),topic:"Invalid future attendance",records:[{studentId:student.studentId,status:"present"}],reason:"Future attendance must be rejected"}),/today or an earlier date/);
      const attendance = await experienceCommand(faculty, randomUUID(), {
        action: "save-attendance",
        offeringId: course.id,
        sessionDate: "2026-09-08",
        topic: "Working with agents",
        records: [{ studentId: student.studentId, status: "absent" }],
        reason: "Publish class attendance",
      });
      await experienceCommand(hod, randomUUID(), {
        action: "save-attendance",
        id: attendance.id,
        expectedRevision: 0,
        offeringId: course.id,
        sessionDate: "2026-09-08",
        topic: "Working with agents",
        records: [{ studentId: student.studentId, status: "present" }],
        reason: "Correct a confirmed attendance entry",
      });
      await experienceCommand(faculty, randomUUID(), {
        action: "publish-result",
        studentId: student.studentId,
        offeringId: course.id,
        expectedRevision: -1,
        percentage: 85,
        published: true,
        reason: "Publish the final assessed course result",
      });
      const child = await experienceStudent(parent, student.studentId!);
      assert.equal(
        child.courses.find((c) => c.offering_id === course.id)!.percentage,
        100,
      );
      assert.equal(
        child.courses.find((c) => c.offering_id === course.id)!.grade_point,
        9,
      );
      assert.ok(child.gpa.cgpa !== null);
      await assert.rejects(
        () =>
          experienceCommand(faculty, randomUUID(), {
            action: "publish-result",
            studentId: student.studentId,
            offeringId: course.id,
            expectedRevision: -1,
            percentage: 86,
            published: true,
            reason: "A stale result should not overwrite",
          }),
        /Reload/,
      );
      o = await experienceOverview(hod);
      await experienceCommand(hod, randomUUID(), {
        action: "save-grading",
        expectedRevision: o.grading!.revision,
        label: "Revised demo scale",
        bands: [
          { minimum: 80, points: 10, letter: "A" },
          { minimum: 0, points: 0, letter: "F" },
        ],
        reason: "Use a revised policy for future results",
      });
      assert.equal(
        (await experienceStudent(student, student.studentId!)).courses.find(
          (c) => c.offering_id === course.id,
        )!.grade_point,
        9,
      );
      const history = await experienceStudent(hod, student.studentId!);
      assert.ok(
        history.history.some((h) => h.resource_type === "course_results"),
      );
      await withCoreTransaction(async (c) => {
        await c.query(
          "UPDATE parent_field_grants SET granted=false WHERE parent_link_id IN (SELECT id FROM parent_links WHERE parent_person_id=$1) AND field_group='marks'",
          [parent.personId],
        );
      });
      const restricted = await experienceStudent(parent, student.studentId!);
      assert.equal(restricted.gpa.cgpa, null);
      assert.equal(
        restricted.courses.find((c) => c.offering_id === course.id)!
          .grade_point,
        null,
      );
      await closePool();
      assert.equal(
        (await experienceOverview(student)).registration[0]!.status,
        "submitted",
      );
    } finally {
      await closePool();
    }
  },
);
