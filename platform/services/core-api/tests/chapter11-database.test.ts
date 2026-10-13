import { experienceCommand } from "../lib/experience-commands";
import { loadPortalSnapshot } from "../lib/projections";
import { lmsCommand } from "../lib/lms-commands";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import {
  finalizeGraphCheckpoint,
  setReviewPaused,
  approvePolicy,
  executePlan,
  exportPlan,
  lockPlan,
  overview,
  readSource,
  sourceAdapterRegistry,
  savePlan,
  seedChapterSources,
} from "../lib/chapter11/service";
import { demoPolicy } from "../lib/chapter11/engine";
import { decideSupportCase, replayAgentRun } from "../lib/support-commands";
import {
  editDraft,
  recordOutcome,
  reviewQueue,
  restoreVersion,
} from "../lib/chapter11/review";

test(
  "Chapter 11 durable integration: policy, sources, locked plan, recovery, approval and evidence",
  { skip: process.env.RUN_CH11_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(
      process.env.CORE_DATABASE_SCHEMA ?? "",
      /^aura_core_test_ch11/,
    );
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed(
        "AURA-SYNTHETIC-SEED-V1",
        "chapter11-isolated-test",
      );
      const { faculty, governance, student, otherDepartment, hod, nextMentor } =
        await withCoreTransaction(async (client) => {
          const generation = await getCurrentGeneration(client);
          const people = await client.query<{
            id: string;
            email: string;
            department_id: string;
          }>(
            "SELECT p.id,p.email,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
            [generation],
          );
          const person = (email: string) =>
            people.rows.find((p) => p.email === email)!;
          const make = (email: string, role: ActorContext["role"]) => ({
            subject: email,
            role,
            displayName: email,
            email,
            clientId: portalOidcClients[role],
            personId: person(email).id,
            departmentId: person(email).department_id,
          });
          const s = await client.query<{ id: string }>(
            "SELECT id FROM student_profiles WHERE generation_id=$1 AND person_id=$2",
            [generation, person("student1@aura.invalid").id],
          );
          const departments = await client.query<{ id: string }>(
            "SELECT id FROM departments WHERE generation_id=$1 AND code='ECE'",
            [generation],
          );
          return {
            hod: make("hod.cse@aura.invalid", "hod"),
            nextMentor: make("faculty2@aura.invalid", "faculty"),
            faculty: make("faculty1@aura.invalid", "faculty"),
            governance: make("governance@aura.invalid", "governance"),
            student: {
              ...make("student1@aura.invalid", "student"),
              studentId: s.rows[0]!.id,
            },
            otherDepartment: departments.rows[0]!.id,
          };
        });
      await assert.rejects(() => overview(student), /not permitted/);
      await assert.rejects(
        () =>
          approvePolicy(governance, {
            policy: demoPolicy,
            rationale: "Cannot self approve",
          }),
        /not permitted/,
      );
      await assert.rejects(
        () =>
          approvePolicy(hod, {
            policy: demoPolicy,
            facultyId: faculty.personId,
            rationale: "An HoD cannot approve mentor thresholds",
          }),
        /not permitted/,
      );
      const policy = await approvePolicy(faculty, {
        policy: demoPolicy,
        rationale:
          "Approve these synthetic demonstration thresholds for my assigned review",
      });
      const vague = await savePlan(faculty, { request: "Review students" });
      assert.ok(vague.body.questions.length >= 2);
      await assert.rejects(
        () => lockPlan(faculty, vague.id, vague.revision),
        /planning questions/,
      );
      const offering = await withCoreTransaction(async (client) => {
        const gen = await getCurrentGeneration(client);
        const course = (
          await client.query<{ id: string }>(
            "SELECT o.id FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND c.code='CS301'",
            [gen],
          )
        ).rows[0]!;
        await client.query(
          "UPDATE registrations SET status='registered',registered_at=now()-interval '14 days' WHERE student_id=$1 AND course_offering_id=$2",
          [student.studentId, course.id],
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
      assert.equal((await seedChapterSources(governance)).inserted, 0);
      await assert.rejects(
        () =>
          readSource(
            { ...faculty, departmentId: otherDepartment },
            student.studentId!,
            "lms",
          ),
        /outside your department/,
      );
      const revised = await savePlan(
        faculty,
        {
          request: "Review this student",
          studentIds: [student.studentId],
          domain: "academic",
          policyId: policy.id,
          feedback: "Focus on all four signals",
        },
        vague.id,
        vague.revision,
      );
      const locked = await lockPlan(faculty, revised.id, revised.revision);
      assert.equal(locked.status, "locked");
      await assert.rejects(
        () => savePlan(faculty, revised.body, revised.id, locked.revision),
        /Unrecognized|locked/i,
      );
      await setReviewPaused(faculty, locked.id, {
        expectedRevision: locked.revision,
        paused: true,
        reason: "Test pause before collection",
      });
      await assert.rejects(() => executePlan(faculty, locked.id), /paused/);
      await setReviewPaused(faculty, locked.id, {
        expectedRevision: locked.revision + 1,
        paused: false,
        reason: "Resume the saved review",
      });
      const stopped = await executePlan(faculty, locked.id, {
        stopAfterStage: "risk",
      });
      assert.equal(stopped.results[0]!.error, "INJECTED_STOP");
      const capturedRevision = await withCoreTransaction(
        async (client) =>
          (
            await client.query(
              "SELECT checkpoint->>'evidenceRevision' AS revision FROM ch11_jobs WHERE plan_id=$1",
              [locked.id],
            )
          ).rows[0]!.revision,
      );
      assert.ok(capturedRevision);
      await experienceCommand(faculty, randomUUID(), {
        action: "save-followup",
        studentId: student.studentId,
        dueOn: new Date().toISOString().slice(0, 10),
        note: "Record a follow-up while the captured review is interrupted.",
        shared: false,
        status: "planned",
        outcome: "",
        reason:
          "Test evidence capture revision through a domain change and restart",
      });
      await closePool(); // New connections simulate a process restarting after its checkpoint committed.
      const resumed = await executePlan(faculty, locked.id);
      assert.equal(resumed.results[0]!.completed, true);
      const exported = await exportPlan(faculty, locked.id);
      assert.equal(exported.jobs.length, 1);
      assert.equal(exported.jobs[0]!.status, "awaiting_faculty");
      assert.equal(
        exported.jobs[0]!.checkpoint.nodeTrace.HumanGate.status,
        "waiting",
      );
      assert.equal(
        exported.jobs[0]!.checkpoint.nodeTrace.DashboardPublisher.visits,
        0,
      );
      for (const node of [
        "ContineoCollector",
        "LMSCollector",
        "InternshipCollector",
        "PlacementCollector",
      ])
        assert.equal(
          exported.jobs[0]!.checkpoint.nodeTrace[node].status,
          "completed",
        );
      await withCoreTransaction(async (client) => {
        const snapshot = (
          await client.query(
            "SELECT institution_revision::text AS revision FROM evidence_snapshots WHERE support_case_id=$1",
            [exported.jobs[0]!.support_case_id],
          )
        ).rows[0]!;
        const currentRevision = (
          await client.query(
            "SELECT revision::text FROM institution_revisions WHERE singleton=true",
          )
        ).rows[0]!.revision;
        assert.equal(snapshot.revision, capturedRevision);
        assert.notEqual(snapshot.revision, currentRevision);
      });
      assert.equal(
        exported.jobs[0]!.checkpoint.composed.validation.checks
          .thresholds_faculty_set,
        true,
      );
      assert.ok(
        exported.events.some((e) => e.event_type === "checkpoint.risk"),
      );
      assert.ok(
        exported.events.some((e) => e.event_type === "mentor.interrupt"),
      );
      const duplicate = await executePlan(faculty, locked.id);
      assert.equal(duplicate.results.length, 0);
      const current = await withCoreTransaction(async (client) => {
        const result = await client.query(
          "SELECT c.id,c.revision,r.id AS run_id,a.id AS artifact_id,a.content_hash,a.recommendation FROM support_cases c JOIN agent_runs r ON r.support_case_id=c.id JOIN agent_artifacts a ON a.agent_run_id=r.id WHERE c.id=$1",
          [exported.jobs[0]!.support_case_id],
        );
        assert.equal(result.rowCount, 1);
        return result.rows[0]!;
      });
      const legacyArtifact = randomUUID();
      await withCoreTransaction(async (c) => {
        await c.query(
          'INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) SELECT $1,generation_id,agent_run_id,artifact_version+1,content_hash,recommendation,\'{"valid":true,"chapter11":true}\'::jsonb FROM agent_artifacts WHERE id=$2',
          [legacyArtifact, current.artifact_id],
        );
      });
      await assert.rejects(
        () =>
          decideSupportCase(faculty, current.id, randomUUID(), {
            expectedRevision: current.revision,
            artifactId: legacyArtifact,
            contentHash: current.content_hash,
            decision: "approved",
            rationale:
              "A legacy report must require refreshed faculty provenance",
          }),
        /Revalidate/,
      );
      current.artifact_id = legacyArtifact;
      const editedPacket = structuredClone(current.recommendation);
      editedPacket.actions[0].dueInDays = 10;
      const editInput = {
        expectedRevision: current.revision,
        artifactId: current.artifact_id,
        packet: editedPacket,
        rationale: "Allow ten days for the agreed mentor check-in",
      };
      const editCommand = randomUUID();
      const edited = await editDraft(
        faculty,
        current.id,
        editCommand,
        editInput,
      );
      assert.equal(
        (await editDraft(faculty, current.id, editCommand, editInput))
          .artifactId,
        edited.artifactId,
      );
      await assert.rejects(
        () =>
          editDraft(faculty, current.id, randomUUID(), {
            ...editInput,
            expectedRevision: edited.revision,
            artifactId: edited.artifactId,
            packet: {
              ...editedPacket,
              summary:
                "Diagnose depression and automatically contact the student",
            },
          }),
        /UNSUPPORTED_AUTHORITY/,
      );
      const hodEdited = await editDraft(hod, current.id, randomUUID(), {
        ...editInput,
        expectedRevision: edited.revision,
        artifactId: edited.artifactId,
        rationale: "Confirm the support wording in a department review",
      });
      await withCoreTransaction(async (client) => {
        const artifacts = await client.query<{
          id: string;
          editor_role: string;
          mentor_edited: boolean;
        }>(
          "SELECT id,validation->>'editorRole' AS editor_role,(validation->>'mentorEdited')::boolean AS mentor_edited FROM agent_artifacts WHERE id=ANY($1::uuid[])",
          [[edited.artifactId, hodEdited.artifactId]],
        );
        assert.equal(artifacts.rowCount, 2);
        assert.deepEqual(
          artifacts.rows.find((a) => a.id === edited.artifactId),
          { id: edited.artifactId, editor_role: "faculty", mentor_edited: true },
        );
        assert.deepEqual(
          artifacts.rows.find((a) => a.id === hodEdited.artifactId),
          { id: hodEdited.artifactId, editor_role: "hod", mentor_edited: false },
        );
      });
      const decision = {
        artifactId: hodEdited.artifactId as string,
        contentHash: hodEdited.contentHash as string,
        expectedRevision: hodEdited.revision as number,
        decision: "approved" as const,
        rationale:
          "Evidence checked and synthetic support plan approved by assigned mentor",
      };
      await assert.rejects(
        () => decideSupportCase(governance, current.id, randomUUID(), decision),
        /not permitted/,
      );
      const setTestMentor = (personId: string) =>
        withCoreTransaction(async (client) => {
          const generation = await getCurrentGeneration(client);
          const assignment = await client.query(
            "UPDATE mentor_assignments SET faculty_person_id=$3 WHERE generation_id=$1 AND student_id=$2",
            [generation, student.studentId, personId],
          );
          assert.equal(assignment.rowCount, 1);
        });
      await setTestMentor(nextMentor.personId);
      try {
        await assert.rejects(
          () => decideSupportCase(nextMentor, current.id, randomUUID(), decision),
          {
            code: "MENTOR_ASSIGNMENT_CHANGED",
            message: /prepared for a different mentor/,
          },
        );
        await assert.rejects(
          () => decideSupportCase(faculty, current.id, randomUUID(), decision),
          { code: "NOT_FOUND", message: /Assigned support case not found/ },
        );
      } finally {
        await setTestMentor(faculty.personId);
      }
      const approved = await decideSupportCase(
        faculty,
        current.id,
        randomUUID(),
        decision,
      );
      assert.equal(approved.plan?.visibleToStudent, true);
      const savedJob = (await exportPlan(faculty, locked.id)).jobs[0]!;
      const staleTrace = structuredClone(savedJob.checkpoint.nodeTrace);
      staleTrace.HumanGate.status = "waiting";
      staleTrace.DashboardPublisher.status = "waiting";
      savedJob.checkpoint.nodeTrace = staleTrace;
      await finalizeGraphCheckpoint(faculty, savedJob as never, staleTrace);
      assert.equal(
        (await exportPlan(faculty, locked.id)).jobs[0]!.checkpoint.nodeTrace
          .DashboardPublisher.status,
        "completed",
      );

      assert.equal(
        (await exportPlan(faculty, locked.id)).jobs[0]!.checkpoint.nodeTrace
          .DashboardPublisher.status,
        "completed",
      );
      assert.equal(
        (await replayAgentRun(governance, current.run_id, randomUUID())).replay
          .matched,
        true,
      );
      assert.equal((await overview(faculty)).jobs[0]!.status, "approved");
      const aggregate = await overview({ ...faculty, role: "hod" });
      assert.equal(aggregate.students.length, 10);
      assert.equal(aggregate.jobs.length, 1);
      assert.equal(aggregate.jobs[0]!.status, "approved");
      const before = await withCoreTransaction(
        async (client) =>
          (await client.query("SELECT count(*)::int AS n FROM marks")).rows[0]!
            .n,
      );
      const withdrawn = await recordOutcome(
        faculty,
        approved.plan!.id,
        randomUUID(),
        {
          expectedRevision: 0,
          status: "withdrawn",
          outcome: "Withdraw the approved publication for a mentor review",
        },
      );
      assert.equal(withdrawn.revision, 1);
      assert.equal(
        (await reviewQueue(faculty)).plans[0]!.visible_to_student,
        false,
      );
      await assert.rejects(
        () =>
          recordOutcome(governance, approved.plan!.id, randomUUID(), {
            expectedRevision: 1,
            status: "completed",
            outcome: "Attempted unauthorized intervention update",
          }),
        /not permitted/,
      );
      const restorationId = randomUUID();
      const restored = await restoreVersion(
        faculty,
        approved.plan!.id,
        restorationId,
        { version: 1, expectedVersion: 1 },
      );
      assert.equal(restored.version, 2);
      assert.equal(
        (
          await restoreVersion(faculty, approved.plan!.id, restorationId, {
            version: 1,
            expectedVersion: 1,
          })
        ).version,
        2,
      );
      await assert.rejects(
        () =>
          restoreVersion(governance, approved.plan!.id, randomUUID(), {
            version: 1,
            expectedVersion: 2,
          }),
        /not permitted/,
      );
      await assert.rejects(
        () =>
          restoreVersion(nextMentor, approved.plan!.id, randomUUID(), {
            version: 1,
            expectedVersion: 2,
          }),
        /not found/,
      );
      await assert.rejects(
        () =>
          restoreVersion(faculty, approved.plan!.id, randomUUID(), {
            version: 1,
            expectedVersion: 1,
          }),
        /Reload version/,
      );
      const versions = (await reviewQueue(faculty)).versions;
      assert.deepEqual(
        versions.map((v) => v.version),
        [2, 1],
      );
      assert.equal(versions[0].content_hash, versions[1].content_hash);
      await withCoreTransaction(async (c) => {
        await assert.rejects(
          () =>
            c.query(
              "UPDATE agent_artifacts SET recommendation='{}'::jsonb WHERE id=$1",
              [edited.artifactId],
            ),
          /append-only/i,
        );
      });
      const studentSnapshot = await loadPortalSnapshot(student);
      assert.deepEqual(
        (
          (studentSnapshot as unknown as Record<string, unknown>)
            .supportPlans as Array<{ plan: unknown }>
        )[0]!.plan,
        editedPacket,
      );
      const parentActor = await withCoreTransaction(async (c) => {
        const row = (
          await c.query(
            "SELECT p.id,p.email,p.display_name FROM parent_links l JOIN people p ON p.id=l.parent_person_id WHERE l.student_id=$1 AND l.active",
            [student.studentId],
          )
        ).rows[0];
        return {
          personId: row.id,
          email: row.email,
          subject: row.email,
          displayName: row.display_name,
          role: "parent" as const,
          clientId: portalOidcClients.parent,
        };
      });
      const parentSnapshot = await loadPortalSnapshot(parentActor);
      assert.deepEqual(
        (
          (parentSnapshot as unknown as Record<string, unknown>)
            .childSupportPlans as Array<{ plan: unknown }>
        )[0]!.plan,
        editedPacket,
      );
      const references = await readSource(
        faculty,
        student.studentId!,
        "priorInterventions",
      );
      assert.ok(references.some((r) => r.id === approved.plan!.id));
      assert.ok(
        references.every(
          (r) => !r.studentId && !r.text.includes(student.email),
        ),
      );
      await assert.rejects(
        () => readSource(nextMentor, student.studentId!, "priorInterventions"),
        /assigned/,
      );
      const adapter = sourceAdapterRegistry.replace(
        "academic",
        async () => ({ source: "academic", studentId: randomUUID() }) as never,
      );
      await assert.rejects(() =>
        readSource(faculty, student.studentId!, "academic"),
      );
      sourceAdapterRegistry.replace("academic", adapter);
      const metrics = (await overview(governance)).metrics;
      assert.equal(metrics.cycles[0]!.decidedRuns, 1);
      assert.equal(metrics.perRun[0]!.approveAsIs, false);
      assert.ok(metrics.perRun[0]!.mentorEditDistance! > 0);

      assert.equal(
        (await reviewQueue(faculty)).plans[0]!.visible_to_student,
        true,
      );
      assert.equal(
        await withCoreTransaction(
          async (client) =>
            (await client.query("SELECT count(*)::int AS n FROM marks"))
              .rows[0]!.n,
        ),
        before,
      );
      const legacySnapshot = async (
        actor: typeof faculty,
      ): Promise<Record<string, unknown>> => loadPortalSnapshot(actor);
      assert.equal(
        ((await legacySnapshot(faculty)).supportCases as unknown[]).length,
        1,
      );
      const assignment = await withCoreTransaction(
        async (client) =>
          (
            await client.query(
              "SELECT revision FROM mentor_assignments WHERE student_id=$1",
              [student.studentId],
            )
          ).rows[0]!,
      );
      await experienceCommand(hod, randomUUID(), {
        action: "assign-mentor",
        studentId: student.studentId,
        facultyId: nextMentor.personId,
        expectedRevision: assignment.revision,
        reason: "Transfer the case to its newly assigned mentor",
      });
      assert.equal(
        ((await legacySnapshot(faculty)).supportCases as unknown[]).length,
        0,
      );
      assert.equal(
        ((await legacySnapshot(nextMentor)).supportCases as unknown[]).length,
        1,
      );
      assert.equal(
        (await overview(faculty)).plans.some((p) => p.id === locked.id),
        false,
      );
      await assert.rejects(
        () => exportPlan(faculty, locked.id),
        /assigned to the selected mentor/,
      );
      assert.equal((await exportPlan(hod, locked.id)).jobs.length, 1);
    } finally {
      await closePool();
    }
  },
);
