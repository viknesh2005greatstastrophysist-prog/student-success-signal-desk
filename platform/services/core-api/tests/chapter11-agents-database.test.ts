import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { approvePolicy, executePlan, exportPlan, lockPlan, savePlan, seedChapterSources } from "../lib/chapter11/service";
import { demoPolicy } from "../lib/chapter11/engine";
import { chainComposer, ModelLimiter } from "../lib/chapter11/provider";
import { replayAgentRun } from "../lib/support-commands";
import { lmsCommand } from "../lib/lms-commands";
import { groqEndpoint } from "./agent-fixtures";
import { draftReply, hasTools, route, startMockOpenAI, toolCallReply, userPayload, type MockReply } from "./mock-openai-server";

/** Brief 12 against real Postgres (disposable schema): the investigator's tools
 * resolve server-side, results land in the evidence snapshot, replay verifies
 * the tool citations, and every call is in the durable audit log. */
test(
  "Chapter 11 investigator: tools run through the service, snapshot carries tool evidence, replay verifies",
  { skip: process.env.RUN_CH11_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_ch11_agent/);
    let turn = 0;
    const reply = (body: unknown): MockReply => {
      if (hasTools(body)) {
        const alias = userPayload(body).case as string;
        return turn++ === 0
          ? toolCallReply([
              { name: "get_attendance_breakdown", args: { case: alias, by: "course" } },
              { name: "get_lms_timeline", args: { case: alias, weeks: 3 } },
              { name: "get_lms_timeline", args: { case: "case-0000", weeks: 3 } },
            ])
          : { content: "ready" };
      }
      return draftReply(userPayload(body));
    };
    const mock = route(reply);
    const server = await startMockOpenAI({ "/g": mock });
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "chapter11-agents-isolated-test");
      const { faculty, governance, student } = await withCoreTransaction(async (client) => {
        const generation = await getCurrentGeneration(client);
        const people = await client.query<{ id: string; email: string; department_id: string }>(
          "SELECT p.id,p.email,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
          [generation],
        );
        const make = (email: string, role: ActorContext["role"]) => {
          const p = people.rows.find((x) => x.email === email)!;
          return { subject: email, role, displayName: email, email, clientId: portalOidcClients[role], personId: p.id, departmentId: p.department_id } as ActorContext;
        };
        const s = await client.query<{ id: string }>(
          "SELECT sp.id FROM student_profiles sp JOIN people p ON p.id=sp.person_id WHERE sp.generation_id=$1 AND p.email='student1@aura.invalid'",
          [generation],
        );
        return { faculty: make("faculty1@aura.invalid", "faculty"), governance: make("governance@aura.invalid", "governance"), student: s.rows[0]!.id };
      });
      // an active LMS registration with one overdue assignment, as in the lifecycle suite
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
      const policy = await approvePolicy(faculty, { policy: demoPolicy, rationale: "Approve these synthetic demonstration thresholds for my assigned review" });
      const plan = await savePlan(faculty, { request: "Review this student", studentIds: [student], domain: "attendance", policyId: policy.id, mode: "model" });
      const locked = await lockPlan(faculty, plan.id, plan.revision);
      const endpoint = groqEndpoint(server.url("/g"));
      const limiter = new ModelLimiter();
      const report = await executePlan(faculty, locked.id, {
        composer: chainComposer([endpoint], { limiter }),
        investigation: { endpoints: [endpoint], chain: { limiter, maxWaitMs: 0 } },
      });
      const exported = await exportPlan(faculty, locked.id);
      const job = exported.jobs[0]!;
      assert.equal(
        report.results[0]!.completed,
        true,
        JSON.stringify({ r: report.results, d: job.failure_diagnosis?.failures, p: job.failure_diagnosis?.provenance?.fallbackReason, a: job.failure_diagnosis?.provenance?.agent }),
      );
      assert.equal(job.checkpoint.nodeTrace.InvestigatorAgent.status, "completed");
      const agent = job.checkpoint.composed.validation.provenance.agent;
      assert.equal(agent.mode, "tools", JSON.stringify(agent));
      assert.deepEqual(
        agent.toolCalls.map((c: { tool: string; status: string; code?: string }) => [c.tool, c.status, c.code ?? null]),
        [
          ["get_attendance_breakdown", "ok", null],
          ["get_lms_timeline", "ok", null],
          ["get_lms_timeline", "refused", "OUT_OF_SCOPE"],
        ],
      );
      assert.ok(agent.turns >= 1 && agent.evidenceValues > 0);
      // durable audit: one row per call, executed or refused
      const events = exported.events.filter((e: { event_type: string }) => e.event_type.startsWith("agent.tool_"));
      assert.deepEqual(events.map((e: { event_type: string }) => e.event_type).sort(), ["agent.tool_call", "agent.tool_call", "agent.tool_refused"]);
      assert.ok(events.every((e: { detail: { input: { args: { case?: string } } } }) => !JSON.stringify(e.detail).includes(student)), "no internal id in the audit");

      // the snapshot carries the tool values; replay re-validates the packet against it
      const stored = await withCoreTransaction(async (client) => {
        const r = await client.query<{ evidence: { tools?: { values: Record<string, number>; studentId: string } }; run_id: string; recommendation: { rationale: Array<{ citations: string[] }> } }>(
          "SELECT e.evidence,ar.id AS run_id,a.recommendation FROM evidence_snapshots e JOIN agent_runs ar ON ar.evidence_snapshot_id=e.id JOIN agent_artifacts a ON a.agent_run_id=ar.id WHERE e.support_case_id=$1",
          [job.support_case_id],
        );
        return r.rows[0]!;
      });
      assert.equal(stored.evidence.tools!.studentId, student);
      assert.ok(Object.keys(stored.evidence.tools!.values).some((k) => k.startsWith("lessonsOpened@weeksago:")));
      assert.ok(stored.recommendation.rationale.flatMap((r) => r.citations).some((p) => p.startsWith("evidence.tools.values.")), "a tool result is cited in the stored draft");
      const replay = await replayAgentRun(governance, stored.run_id, randomUUID());
      assert.equal(replay.replay.matched, true);
      // nothing but the frozen aliases and numbers left: no student id on the wire
      assert.ok(mock.requests.every((r) => !r.raw.includes(student)));
    } finally {
      await server.close();
      await closePool();
    }
  },
);
