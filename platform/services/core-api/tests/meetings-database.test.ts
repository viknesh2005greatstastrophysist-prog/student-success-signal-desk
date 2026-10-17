import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { approvePolicy, executePlan, lockPlan, savePlan, seedChapterSources } from "../lib/chapter11/service";
import { demoPolicy } from "../lib/chapter11/engine";
import { reviewQueue } from "../lib/chapter11/review";
import { decideSupportCase } from "../lib/support-commands";
import { lmsCommand } from "../lib/lms-commands";
import { experienceCommand } from "../lib/experience-commands";
import { experienceOverview, experienceStudent } from "../lib/experience-queries";
import {
  applyMissingCheckins,
  backfillDueOn,
  CHECKIN_NOTE,
  checkinDueOn,
  collegeDate,
  ensurePlanCheckin,
  loadMissingCheckins,
  meetingOutcome,
} from "../lib/meetings";
import { groundedComposer } from "./agent-fixtures";

/** Meeting records after a support plan (owner request, 17 Oct) and the department
 * head's decisions (owner decisions, 17 Oct), against real Postgres in a disposable
 * schema: the mentor approves a policy and runs a review (the department head cannot),
 * the department head approves the draft; the approval creates one check-in for the
 * student's mentor; the backfill finds plans without one; record-meeting validates,
 * completes the check-in and is append-only; reads give staff the reasons and the
 * family only the day. */
test(
  "meeting records: check-in on approval, backfill, record-meeting and who sees what",
  { skip: process.env.RUN_MEETINGS_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_meetings/);
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "meetings-isolated-test");
      const world = await withCoreTransaction(async (client) => {
        const generation = await getCurrentGeneration(client);
        const people = await client.query<{ id: string; email: string; display_name: string; department_id: string }>(
          "SELECT p.id,p.email,p.display_name,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
          [generation],
        );
        const make = (email: string, role: ActorContext["role"]) => {
          const p = people.rows.find((x) => x.email === email)!;
          return { subject: email, role, displayName: p.display_name, email, clientId: portalOidcClients[role], personId: p.id, departmentId: p.department_id } as ActorContext;
        };
        const student = (
          await client.query<{ id: string; register_number: string }>(
            "SELECT sp.id,sp.register_number FROM student_profiles sp JOIN people p ON p.id=sp.person_id WHERE sp.generation_id=$1 AND p.email='student1@aura.invalid'",
            [generation],
          )
        ).rows[0]!;
        const parent = (
          await client.query<{ id: string; email: string; display_name: string }>(
            "SELECT p.id,p.email,p.display_name FROM parent_links l JOIN people p ON p.id=l.parent_person_id WHERE l.student_id=$1 AND l.active",
            [student.id],
          )
        ).rows[0]!;
        return {
          generation,
          student: student.id,
          register: student.register_number,
          faculty: make("faculty1@aura.invalid", "faculty"),
          hod: make("hod.cse@aura.invalid", "hod"),
          otherHod: make("hod.ece@aura.invalid", "hod"),
          governance: make("governance@aura.invalid", "governance"),
          studentActor: { ...make("student1@aura.invalid", "student"), studentId: student.id } as ActorContext,
          parentActor: { subject: parent.email, role: "parent", displayName: parent.display_name, email: parent.email, clientId: portalOidcClients.parent, personId: parent.id } as ActorContext,
        };
      });
      const { faculty, hod, otherHod, governance, student } = world;
      const offering = await withCoreTransaction(async (client) => {
        const course = (
          await client.query<{ id: string }>(
            "SELECT o.id FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND c.code='CS301'",
            [world.generation],
          )
        ).rows[0]!;
        await client.query(
          "UPDATE registrations SET status='registered',registered_at=now()-interval '14 days' WHERE student_id=$1 AND course_offering_id=$2",
          [student, course.id],
        );
        return course.id;
      });
      await lmsCommand(faculty, randomUUID(), {
        action: "save-assignment",
        offeringId: offering,
        title: "Review exercise",
        instructions: "Explain the main idea with an example",
        dueAt: new Date(Date.now() - 86400000).toISOString(),
        maximumScore: 20,
        published: true,
      });
      await seedChapterSources(governance);

      // ---- The mentor approves a policy and runs a review; the department head cannot ----
      await assert.rejects(
        () => approvePolicy(hod, { policy: demoPolicy, facultyId: faculty.personId, rationale: "A department head cannot approve mentor thresholds" }),
        /not permitted/,
      );
      const policy = await approvePolicy(faculty, {
        policy: demoPolicy,
        rationale: "Mentor approves these thresholds for the review",
      });
      await assert.rejects(
        () => savePlan(hod, { request: "Review this student", studentIds: [student], domain: "academic", policyId: policy.id }),
        /not permitted/,
      );
      const saved = await savePlan(faculty, { request: "Review this student", studentIds: [student], domain: "academic", policyId: policy.id });
      const locked = await lockPlan(faculty, saved.id, saved.revision);
      assert.equal(locked.status, "locked");
      for (const head of [hod, otherHod])
        await assert.rejects(() => executePlan(head, locked.id, { composer: groundedComposer() }), /not permitted/);
      const ran = await executePlan(faculty, locked.id, { composer: groundedComposer() });
      assert.equal(ran.results[0]!.completed, true);
      const queue = await reviewQueue(hod);
      const draft = queue.drafts.find((d: { student_id: string }) => d.student_id === student)!;
      assert.ok(draft?.recommendation && draft.content_hash, "the department head reads the full draft");
      const decision = {
        artifactId: draft.artifact_id as string,
        contentHash: draft.content_hash as string,
        expectedRevision: draft.revision as number,
        decision: "approved" as const,
        rationale: "Department head approves the plan for the mentor",
      };
      await assert.rejects(() => decideSupportCase(otherHod, draft.id, randomUUID(), decision), { code: "NOT_FOUND" });

      // ---- Approval by the department head: one check-in, assigned to the student's mentor ----
      const command = randomUUID();
      const approved = await decideSupportCase(hod, draft.id, command, decision);
      const planId = approved.plan!.id;
      assert.ok(approved.checkin?.created && approved.checkin.id);
      const checkin = await withCoreTransaction(async (c) => {
        const rows = await c.query(
          "SELECT f.*,f.due_on::text AS due,d.decided_at,d.faculty_person_id AS decided_by FROM support_followups f JOIN support_plans p ON p.id=f.support_plan_id JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE f.support_plan_id=$1",
          [planId],
        );
        assert.equal(rows.rowCount, 1, "exactly one check-in for the plan");
        return rows.rows[0]!;
      });
      assert.equal(checkin.mentor_person_id, faculty.personId, "assigned to the student's mentor, not the department head");
      assert.equal(checkin.decided_by, hod.personId, "the decision is recorded as the department head's");
      assert.equal(checkin.note, CHECKIN_NOTE);
      assert.equal(checkin.shared, true, "shared with the family");
      assert.equal(checkin.status, "planned");
      assert.equal(checkin.due, checkinDueOn(checkin.decided_at, draft.recommendation), "approval day plus the earliest action window");
      const again = await decideSupportCase(hod, draft.id, command, decision);
      assert.equal(again.duplicate, true);
      assert.equal(again.checkin?.id, approved.checkin.id, "a repeated command creates nothing new");
      await withCoreTransaction(async (c) => {
        const repeat = await ensurePlanCheckin(c, {
          generation: world.generation, planId, studentId: student, dueOn: collegeDate(), fallbackMentorId: hod.personId, actorPersonId: hod.personId, reason: "Second check-in attempt",
        });
        assert.equal(repeat.created, false, "no second check-in while one is open");
        assert.equal(repeat.id, approved.checkin!.id);
        assert.equal((await c.query("SELECT count(*)::int AS n FROM support_followups WHERE support_plan_id=$1", [planId])).rows[0]!.n, 1);
      });

      // ---- The mentor and the department head see the meeting as due ----
      const mentorView = await experienceOverview(faculty);
      const pending = mentorView.meetings!.find((m) => m.plan_id === planId)!;
      assert.equal(pending.meeting, null);
      assert.equal(pending.checkin?.id, approved.checkin.id);
      assert.equal(pending.due_on, checkin.due);
      assert.ok(mentorView.counts.meetings_pending! >= 1);
      assert.ok((await experienceOverview(hod)).meetings!.some((m) => m.plan_id === planId && !m.meeting), "the department head sees it too");
      assert.deepEqual((await experienceOverview(otherHod)).meetings, [], "another department sees none of it");

      // ---- Backfill: a plan approved before this change has no check-in ----
      await withCoreTransaction((c) => c.query("UPDATE support_followups SET support_plan_id=NULL WHERE id=$1", [approved.checkin!.id]));
      const missing = await withCoreTransaction((c) => loadMissingCheckins(c, world.generation));
      assert.deepEqual(missing.map((m) => m.planId), [planId]);
      assert.deepEqual(await withCoreTransaction((c) => loadMissingCheckins(c, world.generation, [student])), [], "an excluded student is left out");
      const filled = await withCoreTransaction((c) => applyMissingCheckins(c, world.generation, missing, governance.personId));
      assert.equal(filled.created, 1);
      const backfilled = await withCoreTransaction(async (c) =>
        (await c.query("SELECT f.id,f.due_on::text AS due,f.mentor_person_id,f.shared,f.note,d.decided_at FROM support_followups f JOIN support_plans p ON p.id=f.support_plan_id JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE f.support_plan_id=$1", [planId])).rows[0]!,
      );
      assert.equal(backfilled.due, backfillDueOn(backfilled.decided_at), "due 7 days after the approval");
      assert.equal(backfilled.mentor_person_id, faculty.personId);
      assert.equal(backfilled.shared, true);
      assert.equal(backfilled.note, CHECKIN_NOTE);
      assert.deepEqual(await withCoreTransaction((c) => loadMissingCheckins(c, world.generation)), [], "a second run finds nothing missing");

      // ---- record-meeting: who may record, and the checks ----
      const today = collegeDate();
      const meeting = {
        action: "record-meeting",
        studentId: student,
        supportPlanId: planId,
        metOn: today,
        reasons: ["Course difficulty", "Health"],
        note: "Tired after a fever; behind in two courses",
        agreedNextStep: "Two tutorials a week and a check on Friday",
      };
      const refused: Array<[Record<string, unknown>, string]> = [
        [{ metOn: collegeDate(new Date(Date.now() + 3 * 86400000)) }, "MEETING_DATE_IN_FUTURE"],
        [{ reasons: [] }, "MEETING_REASON_REQUIRED"],
        [{ reasons: ["Other"], note: "" }, "MEETING_NOTE_REQUIRED"],
        [{ reasons: ["Bored"] }, "MEETING_REASON_UNKNOWN"],
      ];
      for (const [change, code] of refused)
        await assert.rejects(() => experienceCommand(faculty, randomUUID(), { ...meeting, ...change }), { code }, code);
      await assert.rejects(() => experienceCommand(otherHod, randomUUID(), meeting), /outside your assigned access/);
      await assert.rejects(() => experienceCommand(governance, randomUUID(), meeting), /not permitted/);
      await assert.rejects(
        () => experienceCommand(faculty, randomUUID(), { ...meeting, supportPlanId: randomUUID() }),
        { code: "NOT_FOUND" },
      );
      // A frozen record refuses every change, a meeting record included.
      const before = process.env.CORE_FROZEN_REGISTER_NUMBERS;
      process.env.CORE_FROZEN_REGISTER_NUMBERS = world.register;
      try {
        await assert.rejects(() => experienceCommand(faculty, randomUUID(), meeting), { code: "FROZEN_RECORD" });
      } finally {
        if (before === undefined) delete process.env.CORE_FROZEN_REGISTER_NUMBERS;
        else process.env.CORE_FROZEN_REGISTER_NUMBERS = before;
      }

      const recorded = await experienceCommand(faculty, randomUUID(), meeting);
      const stored = await withCoreTransaction(async (c) => {
        const row = (await c.query("SELECT m.*,m.met_on::text AS met FROM support_meetings m WHERE m.id=$1", [recorded.id])).rows[0]!;
        const followup = (await c.query("SELECT status,outcome FROM support_followups WHERE id=$1", [row.followup_id])).rows[0]!;
        const audit = (await c.query("SELECT count(*)::int AS n FROM record_changes WHERE resource_type='support_meetings' AND resource_id=$1", [recorded.id])).rows[0]!.n;
        return { row, followup, audit };
      });
      assert.equal(stored.row.followup_id, backfilled.id, "it completes the plan's open check-in");
      assert.equal(stored.row.support_plan_id, planId);
      assert.equal(stored.row.met, today);
      assert.deepEqual(stored.row.reasons, ["Health", "Course difficulty"], "kept in the list's order");
      assert.equal(stored.row.agreed_next_step, meeting.agreedNextStep);
      assert.equal(stored.row.recorded_by, faculty.personId);
      assert.deepEqual(stored.followup, { status: "completed", outcome: meetingOutcome(today) });
      assert.equal(stored.audit, 1, "audited");
      await assert.rejects(
        () => experienceCommand(hod, randomUUID(), { ...meeting, followupId: backfilled.id }),
        { code: "MEETING_ALREADY_RECORDED" },
      );
      await withCoreTransaction(async (c) => {
        await assert.rejects(() => c.query("UPDATE support_meetings SET note='changed' WHERE id=$1", [recorded.id]), /append-only/i);
      });
      // With every check-in done, the department head records a further meeting on a new one.
      const second = await experienceCommand(hod, randomUUID(), { ...meeting, reasons: ["Timetable clash"], note: "" });
      const secondRow = await withCoreTransaction(async (c) =>
        (await c.query("SELECT m.recorded_by,f.status,f.mentor_person_id FROM support_meetings m JOIN support_followups f ON f.id=m.followup_id WHERE m.id=$1", [second.id])).rows[0]!,
      );
      assert.deepEqual(secondRow, { recorded_by: hod.personId, status: "completed", mentor_person_id: faculty.personId });

      // ---- Who sees what: staff the reasons, the student and the parent only the day ----
      const latest = (await experienceOverview(faculty)).meetings!.find((m) => m.plan_id === planId)!;
      assert.equal(latest.meeting?.met_on, today);
      assert.equal((await experienceOverview(faculty)).counts.meetings_pending, 0);
      const staff = await experienceStudent(hod, student);
      const staffPlan = staff.support.find((p) => p.id === planId)!;
      assert.equal(staffPlan.meeting?.met_on, today);
      assert.ok(staffPlan.meeting?.reasons.length);
      const plans = (await reviewQueue(faculty)).plans;
      assert.equal(plans.find((p: { id: string }) => p.id === planId)?.meeting?.met_on, today, "Outcomes reads the meeting");
      const own = await experienceStudent(world.studentActor, student);
      const ownPlan = own.support.find((p) => p.id === planId)!;
      assert.equal(ownPlan.met_on, today, "the student sees the day they met");
      assert.equal("meeting" in ownPlan, false);
      for (const leak of ["Course difficulty", "Health", "Timetable clash", "Tired after a fever", "Two tutorials"])
        assert.equal(JSON.stringify(own.support).includes(leak), false, leak);
      const family = await experienceStudent(world.parentActor, student);
      if (family.grants.includes("support")) {
        assert.equal(family.support.find((p) => p.id === planId)?.met_on, today);
        for (const leak of ["Course difficulty", "Health", "Timetable clash", "Tired after a fever"])
          assert.equal(JSON.stringify(family.support).includes(leak), false, leak);
      } else assert.deepEqual(family.support, []);
    } finally {
      await closePool();
    }
  },
);
