import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PoolClient } from "pg";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { quoteIdentifier, loadCoreConfig } from "../lib/config";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, getPool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { lmsCommand } from "../lib/lms-commands";
import {
  approvePolicy,
  executePlan,
  lockPlan,
  savePlan,
  seedChapterSources,
  setReviewPaused,
} from "../lib/chapter11/service";
import { demoPolicy } from "../lib/chapter11/engine";

// Opt-in: needs a disposable schema (aura_core_test_ch11_lease*) on a reachable
// PostgreSQL; never point it at a project or deployed schema.
test(
  "Chapter 11 executor: expired attempt-limit leases are swept and a pause committed during escalation leaves the job resumable",
  { skip: process.env.RUN_CH11_LEASE_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(
      process.env.CORE_DATABASE_SCHEMA ?? "",
      /^aura_core_test_ch11_lease/,
    );
    let holder: PoolClient | undefined;
    let pauseCommitted: Promise<void> | undefined;
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed(
        "AURA-SYNTHETIC-SEED-V1",
        "chapter11-lease-isolated-test",
      );
      const { faculty, governance, studentId } = await withCoreTransaction(
        async (client) => {
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
          return {
            faculty: make("faculty1@aura.invalid", "faculty"),
            governance: make("governance@aura.invalid", "governance"),
            studentId: s.rows[0]!.id,
          };
        },
      );
      // Same evidence preparation as the main Chapter 11 database test, so the
      // student is flagged and the review reaches composition.
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
          [studentId, course.id],
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
      const policy = await approvePolicy(faculty, {
        policy: demoPolicy,
        rationale:
          "Approve these synthetic demonstration thresholds for my assigned review",
      });
      const draft = await savePlan(faculty, {
        request: "Review this student",
        studentIds: [studentId],
        domain: "academic",
        policyId: policy.id,
        feedback: "Focus on all four signals",
        mode: "model",
      });
      const plan = await lockPlan(faculty, draft.id, draft.revision);
      assert.equal(plan.status, "locked");

      const sql = async <T extends Record<string, unknown>>(
        text: string,
        params: unknown[] = [],
      ) =>
        withCoreTransaction(
          async (client) => (await client.query<T>(text, params)).rows,
        );
      const job = async () =>
        (
          await sql<{
            id: string;
            status: string;
            stage: string;
            attempts: number;
            error_code: string | null;
            escalated_at: Date | null;
            lease_until: Date | null;
            failure_diagnosis: { code?: string };
          }>(
            "SELECT id,status,stage,attempts,error_code,escalated_at,lease_until,failure_diagnosis FROM ch11_jobs WHERE plan_id=$1",
            [plan.id],
          )
        )[0]!;
      // The composers never reach a provider. A throwing generate is the AI
      // outage (the case waits for a retry); a draft that never validates forces
      // the repair-budget escalation to the human gate deterministically.
      const failingComposer = {
        modelId: "lease-test-fixture",
        async generate(): Promise<never> {
          throw new Error("model unavailable");
        },
      };
      const invalidComposer = {
        modelId: "invalid-draft-fixture",
        async generate(): Promise<unknown> {
          return { not: "a draft" };
        },
      };

      // B1: attempts=3, executor gone. A live lease is left alone; an expired
      // one is moved to the terminal needs-human state, once, with an audit row.
      await sql(
        "UPDATE ch11_jobs SET status='running',attempts=3,lease_token=$2,lease_until=now()+interval '10 minutes' WHERE plan_id=$1",
        [plan.id, randomUUID()],
      );
      assert.equal(
        (await executePlan(faculty, plan.id, { composer: failingComposer }))
          .results.length,
        0,
      );
      assert.equal((await job()).status, "running");
      await sql(
        "UPDATE ch11_jobs SET lease_until=now()-interval '1 minute' WHERE plan_id=$1",
        [plan.id],
      );
      const swept = await executePlan(faculty, plan.id, {
        composer: failingComposer,
      });
      assert.equal(swept.results.length, 0);
      const stuck = await job();
      assert.equal(stuck.status, "failed");
      assert.equal(stuck.error_code, "LEASE_EXPIRED");
      assert.ok(stuck.escalated_at, "escalated_at is set");
      assert.equal(stuck.lease_until, null);
      assert.equal(stuck.failure_diagnosis.code, "LEASE_EXPIRED");
      const stopEvents = () =>
        sql<{ code: string }>(
          "SELECT detail->'output'->>'code' AS code FROM ch11_events WHERE subject_id=$1 AND event_type='execution.stopped'",
          [stuck.id],
        );
      assert.deepEqual(await stopEvents(), [{ code: "LEASE_EXPIRED" }]);
      await executePlan(faculty, plan.id, { composer: failingComposer });
      assert.equal((await stopEvents()).length, 1, "the sweep is not repeated");

      // B4: a pause that commits after the HumanGate pause check but before the
      // escalation write. The composer, which runs earlier in the same attempt,
      // takes the plan row lock from another connection; the escalation write
      // must queue behind it and, once the pause commits, see paused=true.
      await sql(
        "UPDATE ch11_jobs SET status='queued',stage='collect',attempts=0,error_code=NULL,escalated_at=NULL,failure_diagnosis='{}'::jsonb,lease_until=NULL,lease_token=NULL,checkpoint='{}'::jsonb WHERE plan_id=$1",
        [plan.id],
      );
      const schema = quoteIdentifier(loadCoreConfig().databaseSchema);
      const racingComposer = {
        modelId: "pause-race-fixture",
        async generate(): Promise<unknown> {
          if (!holder) {
            holder = await getPool().connect();
            await holder.query("BEGIN");
            await holder.query(`SET LOCAL search_path TO ${schema}, public`);
            await holder.query(
              "SELECT id FROM ch11_plans WHERE id=$1 FOR UPDATE",
              [plan.id],
            );
            const lockHolder = holder;
            pauseCommitted = (async () => {
              // Wait until the escalation write is queued behind the lock.
              const deadline = Date.now() + 8000;
              while (Date.now() < deadline) {
                const waiting = await getPool().query(
                  "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ch11_plans%FOR UPDATE%'",
                );
                if (waiting.rowCount) break;
                await new Promise((r) => setTimeout(r, 25));
              }
              await lockHolder.query(
                "UPDATE ch11_plans SET paused=true,revision=revision+1 WHERE id=$1",
                [plan.id],
              );
              await lockHolder.query("COMMIT");
            })();
          }
          return { not: "a draft" };
        },
      };
      const raced = await executePlan(faculty, plan.id, {
        composer: racingComposer,
      });
      await pauseCommitted;
      assert.equal(raced.results[0]!.error, "PLAN_PAUSED");
      const paused = await job();
      assert.equal(paused.status, "queued", "job is resumable, not terminal");
      assert.equal(paused.escalated_at, null);
      assert.equal(paused.attempts, 0, "the paused attempt is not counted");
      const revision = (
        await sql<{ revision: number; paused: boolean }>(
          "SELECT revision,paused FROM ch11_plans WHERE id=$1",
          [plan.id],
        )
      )[0]!;
      assert.equal(revision.paused, true);
      await setReviewPaused(faculty, plan.id, {
        paused: false,
        expectedRevision: revision.revision,
        reason: "Resume after the pause race",
      });
      const resumed = await executePlan(faculty, plan.id, {
        composer: invalidComposer,
      });
      assert.equal(resumed.results[0]!.escalated, true);
      const escalated = await job();
      assert.equal(escalated.status, "failed");
      assert.equal(escalated.error_code, "REPAIR_BUDGET_EXHAUSTED");
      assert.ok(escalated.escalated_at);
      // An escalated job opens no support case and is not run again.
      const [{ support_case_id: openedCase }] = await sql<{
        support_case_id: string | null;
      }>("SELECT support_case_id FROM ch11_jobs WHERE plan_id=$1", [plan.id]);
      assert.equal(openedCase, null);
      assert.equal(
        (await executePlan(faculty, plan.id, { composer: invalidComposer }))
          .results.length,
        0,
      );

      // C1: when every model fails the job waits as "AI unavailable" instead of
      // escalating: no escalation, no spent attempt, retryable, with an audit row.
      await sql(
        "UPDATE ch11_jobs SET status='queued',stage='collect',attempts=0,error_code=NULL,escalated_at=NULL,failure_diagnosis='{}'::jsonb,lease_until=NULL,lease_token=NULL,checkpoint='{}'::jsonb WHERE plan_id=$1",
        [plan.id],
      );
      for (const round of [1, 2, 3, 4]) {
        const down = await executePlan(faculty, plan.id, {
          composer: failingComposer,
        });
        assert.equal(down.results[0]!.error, "AI_UNAVAILABLE", `round ${round}`);
        const waiting = await job();
        assert.equal(waiting.status, "failed");
        assert.equal(waiting.error_code, "AI_UNAVAILABLE");
        assert.equal(waiting.escalated_at, null, "never terminal");
        assert.equal(waiting.attempts, 0, "an outage does not spend the attempt budget");
      }
      const unavailableEvents = await sql<{ code: string }>(
        "SELECT detail->'output'->>'code' AS code FROM ch11_events WHERE subject_id=$1 AND event_type='execution.stopped'",
        [(await job()).id],
      );
      assert.equal(unavailableEvents.filter((e) => e.code === "AI_UNAVAILABLE").length, 4);
    } finally {
      if (holder) {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }
      await closePool();
    }
  },
);
