import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { closePool, withCoreTransaction } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { approvePolicy, executePlan, exportPlan, lockPlan, overview, savePlan, seedChapterSources, setReviewPaused } from "../lib/chapter11/service";
import { planWithAgent } from "../lib/chapter11/planning";
import { demoPolicy } from "../lib/chapter11/engine";
import { chainComposer, ModelLimiter } from "../lib/chapter11/provider";
import { editDraft, reviewQueue } from "../lib/chapter11/review";
import { decideSupportCase, replayAgentRun } from "../lib/support-commands";
import { lmsCommand } from "../lib/lms-commands";
import { experienceOverview } from "../lib/experience-queries";
import { groqEndpoint, groundedComposer } from "./agent-fixtures";
import { draftReply, hasTools, route, scriptedPlanner, startMockOpenAI, toolCallReply, userPayload, type MockReply } from "./mock-openai-server";

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
    let semesterCut = 12;
    const planner = route(
      scriptedPlanner(({ feedback, policyAlias }) =>
        feedback
          ? { domain: "attendance", policy: policyAlias, basis: "current", filter: { semesterMax: semesterCut }, questions: [] }
          : {
              policy: policyAlias,
              allMine: true,
              questions: [
                "Does 'this month' mean the last 30 days or the calendar month?",
                "What should 'attendance dropped' be measured against: the policy minimum or an earlier figure?",
              ],
            },
      ),
    );
    const server = await startMockOpenAI({ "/g": mock, "/p": planner });
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

      // ---- Brief 13: free text -> plan draft -> feedback revises the same plan ----
      const assigned = await withCoreTransaction(async (client) =>
        (
          await client.query<{ id: string; semester: number }>(
            "SELECT s.id,s.semester FROM mentor_assignments m JOIN student_profiles s ON s.id=m.student_id WHERE m.faculty_person_id=$1 AND m.generation_id=$2",
            [faculty.personId, await getCurrentGeneration(client)],
          )
        ).rows,
      );
      const semesters = [...new Set(assigned.map((r) => r.semester))].sort((a, b) => a - b);
      semesterCut = semesters.length > 1 ? semesters.at(-1)! - 1 : semesters[0]!;
      const planEndpoint = groqEndpoint(server.url("/p"));
      const chain = { limiter: new ModelLimiter(), maxWaitMs: 0 };
      const request = "check my mentees whose attendance dropped this month";
      const created = await planWithAgent(faculty, { request, mode: "model" }, { endpoints: [planEndpoint], chain, commandId: randomUUID() });
      assert.equal(created.status, "clarifying");
      assert.equal(created.body.ready, false);
      assert.equal(created.body.agent!.mode, "tools");
      assert.ok(created.body.questions.length >= 2);
      assert.ok(created.body.questions.some((q: string) => /this month/.test(q)));
      assert.equal(created.body.policyId, policy.id);
      const mine = new Set(assigned.map((r) => r.id));
      assert.ok(created.body.studentIds!.length > 0 && created.body.studentIds!.every((id: string) => mine.has(id)), "resolved server-side to in-scope students");
      await assert.rejects(() => lockPlan(faculty, created.id, created.revision), /planning questions/);
      // a retried command returns the same plan without another model call
      const calls = planner.requests.length;
      const again = await planWithAgent(faculty, { request, mode: "model" }, { endpoints: [planEndpoint], chain, commandId: created.id });
      assert.equal(again.id, created.id);
      assert.equal(planner.requests.length, calls);

      const stale = { request, mode: "model", feedback: "x" };
      const revised = await planWithAgent(
        faculty,
        {
          request,
          mode: "model",
          feedback: "since mid-term; leave out final-years, focus attendance",
          studentIds: created.body.studentIds,
          domain: created.body.domain,
          policyId: created.body.policyId,
        },
        { id: created.id, expectedRevision: created.revision, endpoints: [planEndpoint], chain },
      );
      assert.equal(revised.id, created.id, "the same plan, revised in place");
      assert.equal(revised.revision, created.revision + 1);
      assert.equal(revised.body.domain, "attendance");
      assert.deepEqual(revised.body.questions, []);
      assert.equal(revised.status, "ready");
      assert.ok(revised.body.studentIds!.every((id: string) => created.body.studentIds!.includes(id)), "narrowed, never widened");
      if (semesters.length > 1) assert.ok(revised.body.studentIds!.length < created.body.studentIds!.length);
      await assert.rejects(
        () => planWithAgent(faculty, stale, { id: created.id, expectedRevision: created.revision, endpoints: [planEndpoint], chain }),
        /Reload the plan/,
      );
      // a student outside the mentor's assignments cannot be pinned in
      const foreign = await withCoreTransaction(async (client) =>
        (await client.query<{ id: string }>("SELECT id FROM student_profiles WHERE generation_id=$1 AND NOT id=ANY($2::uuid[]) LIMIT 1", [await getCurrentGeneration(client), [...mine]])).rows[0]!.id,
      );
      await assert.rejects(
        () => planWithAgent(faculty, { request, mode: "model", studentIds: [foreign], domain: "attendance", policyId: policy.id }, { endpoints: [planEndpoint], chain, commandId: randomUUID() }),
        /assigned|department/i,
      );
      // the planner only drafts: the mentor locks
      const lockedPlan = await lockPlan(faculty, revised.id, revised.revision);
      assert.equal(lockedPlan.status, "locked");
      const exportedPlan = await exportPlan(faculty, created.id);
      assert.ok(exportedPlan.events.some((e: { event_type: string }) => e.event_type === "planner.tool_call"));
      assert.ok(planner.requests.every((r) => !r.raw.includes(student) && !r.raw.includes(policy.id)));
    } finally {
      await server.close();
      await closePool();
    }
  },
);

/** C1, L1, L7, #8, #12 against real Postgres (disposable schema): every review
 * runs on AI and waits as "AI unavailable" when no model answers; the mentor's
 * explicit student selection is authoritative; only the assigned mentor sees
 * risk figures and runs plan commands; retired rule-based drafts stay readable
 * and are never decided. Stub models and the local mock server only. */
test(
  "Chapter 11 AI-only reviews: unavailable state, scope rule, read-only roles, privacy and legacy drafts",
  { skip: process.env.RUN_CH11_DB_TESTS !== "1", timeout: 240000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_ch11_agent/);
    const down = route({ status: 503, body: { error: { message: "down" } } });
    let planCalls = 0;
    const planner = route(
      scriptedPlanner(({ request, feedback, policyAlias }) => {
        planCalls++;
        const question = /this cycle/.test(request)
          ? feedback
            ? "Which time window does 'this cycle' refer to, and should I use the current cycle's attendance figures as you specified?"
            : "Which time window does 'this cycle' refer to, and should I use the current cycle's attendance figures?"
          : null;
        return {
          domain: "attendance",
          policy: policyAlias,
          allMine: /all my mentees/.test(request),
          questions: question ? [question] : [],
        };
      }),
    );
    const server = await startMockOpenAI({ "/down": down, "/p": planner });
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "chapter11-ai-only-isolated-test");
      const { faculty, hod, governance, student, mentees } = await withCoreTransaction(async (client) => {
        const generation = await getCurrentGeneration(client);
        const people = await client.query<{ id: string; email: string; department_id: string }>(
          "SELECT p.id,p.email,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
          [generation],
        );
        const make = (email: string, role: ActorContext["role"]) => {
          const p = people.rows.find((x) => x.email === email)!;
          return { subject: email, role, displayName: email, email, clientId: portalOidcClients[role], personId: p.id, departmentId: p.department_id } as ActorContext;
        };
        const faculty = make("faculty1@aura.invalid", "faculty");
        const s = await client.query<{ id: string }>(
          "SELECT sp.id FROM student_profiles sp JOIN people p ON p.id=sp.person_id WHERE sp.generation_id=$1 AND p.email='student1@aura.invalid'",
          [generation],
        );
        const assigned = await client.query<{ id: string }>(
          "SELECT s.id FROM mentor_assignments m JOIN student_profiles s ON s.id=m.student_id WHERE m.faculty_person_id=$1 AND m.generation_id=$2 ORDER BY s.register_number",
          [faculty.personId, generation],
        );
        return {
          faculty,
          hod: make("hod.cse@aura.invalid", "hod"),
          governance: make("governance@aura.invalid", "governance"),
          student: s.rows[0]!.id,
          mentees: assigned.rows.map((r) => r.id),
        };
      });
      assert.ok(mentees.length >= 3 && mentees.includes(student));
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

      // ---- C1: every model fails -> no draft, a visible "AI unavailable" state, audited ----
      const draft = await savePlan(faculty, { request: "Review this student", studentIds: [student], domain: "attendance", policyId: policy.id });
      assert.equal(draft.body.mode, "model", "there is no rule-based mode any more");
      const locked = await lockPlan(faculty, draft.id, draft.revision);
      const limiter = new ModelLimiter();
      const dead = chainComposer([groqEndpoint(server.url("/down")), { ...groqEndpoint(server.url("/down")), kind: "gemini", model: "gemini-test" }], { limiter, maxWaitMs: 0 })!;
      const report = await executePlan(faculty, locked.id, { composer: dead });
      assert.equal(report.results[0]!.error, "AI_UNAVAILABLE");
      const waiting = (await exportPlan(faculty, locked.id)).jobs[0]!;
      assert.equal(waiting.status, "failed");
      assert.equal(waiting.error_code, "AI_UNAVAILABLE");
      assert.equal(waiting.escalated_at, null, "retryable, not terminal");
      assert.equal(waiting.attempts, 0);
      assert.equal(waiting.support_case_id, null, "no case and so no draft exists");
      assert.equal(waiting.checkpoint.composed, undefined);
      const reasons: string[] = waiting.failure_diagnosis.reasons;
      assert.ok(reasons.some((r) => /^groq qwen\/qwen3\.8-27b: MODEL_HTTP_503/.test(r)), JSON.stringify(reasons));
      assert.ok(reasons.some((r) => /^gemini gemini-test: MODEL_HTTP_503/.test(r)));
      const exportedDown = await exportPlan(faculty, locked.id);
      const stopped = exportedDown.events.find((e: { event_type: string; detail: { output?: { code?: string } } }) => e.event_type === "execution.stopped" && e.detail.output?.code === "AI_UNAVAILABLE");
      assert.ok(stopped, "the reason is in the durable audit log");
      assert.deepEqual(stopped.detail.output.reasons, reasons);
      assert.ok(exportedDown.events.some((e: { event_type: string }) => e.event_type === "model.egress"), "requests that were sent are audited too");
      assert.equal(
        await withCoreTransaction(async (c) => (await c.query("SELECT count(*)::int AS n FROM support_cases WHERE source=$1", [`chapter11:${locked.id}`])).rows[0]!.n),
        0,
      );
      const seen = (await overview(faculty)).jobs.find((j: { id: string }) => j.id === waiting.id)!;
      assert.equal(seen.status, "ai_unavailable");
      assert.deepEqual(seen.failure_reasons, reasons);
      assert.ok(!("offered_template" in seen), "no template is offered in place of a draft");
      // the mentor retries when a model is back: same job, same plan
      const retried = await executePlan(faculty, locked.id, { composer: groundedComposer() });
      assert.equal(retried.results[0]!.completed, true);
      const drafted = (await exportPlan(faculty, locked.id)).jobs[0]!;
      assert.equal(drafted.status, "awaiting_faculty");
      assert.equal(drafted.checkpoint.composed.mode, "model");
      const caseId: string = drafted.support_case_id;
      // Review R-04: the snapshot carries the time the evidence was collected, not the publish time.
      const snapshotAt = await withCoreTransaction(async (c) => (await c.query<{ captured_at: Date }>("SELECT captured_at FROM evidence_snapshots WHERE support_case_id=$1", [caseId])).rows[0]!.captured_at);
      assert.equal(new Date(snapshotAt).toISOString(), new Date(drafted.checkpoint.capturedAt).toISOString());

      // ---- #12: only the assigned mentor runs plan commands ----
      for (const actor of [hod, governance]) {
        await assert.rejects(() => savePlan(actor, { request: "Review this student", studentIds: [student], domain: "attendance", policyId: policy.id }), /not permitted/);
        await assert.rejects(() => planWithAgent(actor, { request: "Review this student" }, { commandId: randomUUID() }), /not permitted/);
        await assert.rejects(() => lockPlan(actor, locked.id, locked.revision), /not permitted/);
        await assert.rejects(() => executePlan(actor, locked.id), /not permitted/);
        await assert.rejects(() => setReviewPaused(actor, locked.id, { paused: true, expectedRevision: locked.revision, reason: "Not allowed" }), /not permitted/);
      }
      await setReviewPaused(faculty, locked.id, { paused: true, expectedRevision: (await exportPlan(faculty, locked.id)).plan.revision, reason: "Mentor can pause" });
      await setReviewPaused(faculty, locked.id, { paused: false, expectedRevision: (await exportPlan(faculty, locked.id)).plan.revision, reason: "Mentor can resume" });

      // ---- #8: risk figures belong to the assigned mentor ----
      const mine = await reviewQueue(faculty);
      assert.equal(mine.drafts.length, 1);
      assert.ok(mine.drafts[0]!.recommendation && mine.drafts[0]!.signals?.length);
      assert.deepEqual(mine.legacyDrafts, []);
      // E2E log #1, #2, #9: the queue, Support reviews and the overview share one definition of "awaiting".
      assert.equal(mine.awaitingCount, 1);
      assert.equal((await experienceOverview(faculty)).counts.pending_reviews, mine.awaitingCount);
      assert.equal(mine.drafts[0]!.earlier_count, 0);
      for (const actor of [hod]) {
        const queue = await reviewQueue(actor);
        assert.equal(queue.drafts.length, 1);
        assert.equal(queue.awaitingCount, 1);
        assert.equal((await experienceOverview(actor)).counts.pending_reviews, queue.awaitingCount);
        assert.deepEqual(Object.keys(queue.drafts[0]!).sort(), ["display_name", "drafted_at", "earlier_count", "earlier_drafts", "evidence_current", "evidence_generation", "frozen", "id", "mode", "model_id", "register_number", "revision", "status", "student_id"]);
      }
      const ownView = await overview(faculty);
      assert.ok(ownView.riskView.length > 0 && ownView.riskView.some((r) => r.score !== null));
      assert.ok(ownView.jobs.some((j: { risk: unknown }) => j.risk));
      for (const actor of [hod, governance]) {
        const view = await overview(actor);
        assert.deepEqual(view.riskView, []);
        assert.ok(view.jobs.length > 0 && view.jobs.every((j: { risk: unknown }) => j.risk === null));
        assert.ok(
          view.trends.every((t: Record<string, unknown>) => ["low", "medium", "high"].every((b) => Number(t[`count_${b}`]) >= 3 || t[`average_${b}`] === null)),
          "no band average over fewer than three students",
        );
        const process = await exportPlan(actor, locked.id);
        assert.ok(process.jobs.every((j: { checkpoint: Record<string, unknown> }) => !("risk" in j.checkpoint) && !("evidence" in j.checkpoint)));
        assert.ok(process.events.every((e: { detail: unknown }) => JSON.stringify(e.detail) === '{"redacted":true}'));
      }
      assert.ok(ownView.trends.some((t: Record<string, unknown>) => t.average_medium !== null || t.average_high !== null), "the mentor still sees their own averages");

      // ---- C1: retired rule-based drafts stay readable and are never decided ----
      await withCoreTransaction((c) => c.query("UPDATE agent_runs SET mode='deterministic' WHERE support_case_id=$1", [caseId]));
      const queue = await reviewQueue(faculty);
      assert.deepEqual(queue.drafts, [], "leaves the active queue");
      assert.equal(queue.awaitingCount, 0, "a legacy draft is never counted as awaiting");
      assert.equal((await experienceOverview(faculty)).counts.pending_reviews, 0);
      assert.equal(queue.legacyDrafts.length, 1, "stays viewable");
      assert.equal(queue.legacyDrafts[0]!.id, caseId);
      assert.ok(queue.legacyDrafts[0]!.recommendation);
      assert.equal(queue.legacyDrafts[0]!.register_number.length > 0, true);
      const legacy = queue.legacyDrafts[0]!;
      await assert.rejects(
        () => decideSupportCase(faculty, caseId, randomUUID(), { artifactId: legacy.artifact_id, contentHash: legacy.content_hash, expectedRevision: legacy.revision, decision: "approved", rationale: "Attempt to decide a retired draft" }),
        { code: "LEGACY_DRAFT_READ_ONLY" },
      );
      await assert.rejects(
        () => editDraft(faculty, caseId, randomUUID(), { expectedRevision: legacy.revision, artifactId: legacy.artifact_id, packet: legacy.recommendation, rationale: "Attempt to edit a retired draft" }),
        { code: "LEGACY_DRAFT_READ_ONLY" },
      );
      assert.equal(
        await withCoreTransaction(async (c) => (await c.query("SELECT status FROM support_cases WHERE id=$1", [caseId])).rows[0]!.status),
        "awaiting_faculty",
        "still undecided",
      );
      assert.equal((await reviewQueue(hod)).legacyDrafts.length, 1);

      // ---- L1, L7: the explicit selection is authoritative ----
      const planEndpoint = groqEndpoint(server.url("/p"));
      const chain = { limiter: new ModelLimiter(), maxWaitMs: 0 };
      const chosen = mentees[0]!;
      const request = "Review all my mentees for attendance risk.";
      const base = { request, studentIds: [chosen], domain: "attendance" as const, policyId: policy.id };
      const created = await planWithAgent(faculty, base, { endpoints: [planEndpoint], chain, commandId: randomUUID() });
      assert.deepEqual(created.body.studentIds, [chosen], "the planner did not replace the selection");
      assert.deepEqual(created.body.scope, { basis: "selected", selected: 1 });
      assert.equal(created.body.scopeConflict!.selected, 1);
      assert.equal(created.body.scopeConflict!.implied, mentees.length);
      assert.deepEqual([...created.body.scopeConflict!.impliedStudentIds!].sort(), [...mentees].sort());
      assert.equal(created.status, "clarifying");
      assert.match(created.body.questions[0]!, /Nothing changes until you confirm/);
      await assert.rejects(() => lockPlan(faculty, created.id, created.revision), /planning questions/);
      // saving again with nothing new re-plans nothing (the saved resolution is deterministic)
      const calls = planCalls;
      const unchanged = await planWithAgent(faculty, base, { id: created.id, expectedRevision: created.revision, endpoints: [planEndpoint], chain });
      assert.equal(unchanged.revision, created.revision);
      assert.equal(planCalls, calls);
      // the revise form re-sends the same selection with a note: it is still pinned, never widened to every mentee
      const noted = await planWithAgent(faculty, { ...base, feedback: "Use the current cycle." }, { id: created.id, expectedRevision: created.revision, endpoints: [planEndpoint], chain });
      assert.deepEqual(noted.body.studentIds, [chosen]);
      assert.equal(noted.body.scopeConflict!.resolution, undefined, "only the mentor resolves it");
      const noted2 = await planWithAgent(faculty, { ...base, feedback: "Measure risk by the policy score." }, { id: created.id, expectedRevision: noted.revision, endpoints: [planEndpoint], chain });
      assert.equal(noted2.body.feedback, "Use the current cycle.\nMeasure risk by the policy score.", "notes accumulate on separate lines");
      assert.deepEqual(noted2.body.studentIds, [chosen]);
      // keep: the selection stays and the plan can be locked
      const kept = await planWithAgent(faculty, { request, scopeChoice: "keep" }, { id: created.id, expectedRevision: noted2.revision });
      assert.deepEqual(kept.body.studentIds, [chosen]);
      assert.equal(kept.body.scopeConflict!.resolution, "kept");
      assert.equal(kept.status, "ready");
      const stays = await planWithAgent(faculty, { ...base, feedback: "Also note the mid-term." }, { id: created.id, expectedRevision: kept.revision, endpoints: [planEndpoint], chain });
      assert.equal(stays.status, "ready", "a kept conflict is not asked again for the same request and selection");
      assert.deepEqual(stays.body.studentIds, [chosen]);
      assert.equal((await lockPlan(faculty, stays.id, stays.revision)).status, "locked");
      await assert.rejects(() => planWithAgent(faculty, { request, scopeChoice: "keep" }, { id: created.id, expectedRevision: 99 }), /locked|Reload/);
      // switch: only an explicit confirmation moves the scope to the set the request describes
      const second = await planWithAgent(faculty, base, { endpoints: [planEndpoint], chain, commandId: randomUUID() });
      await assert.rejects(() => planWithAgent(faculty, { request, scopeChoice: "switch" }, { id: second.id, expectedRevision: second.revision + 5 }), /Reload/);
      const switched = await planWithAgent(faculty, { request, scopeChoice: "switch" }, { id: second.id, expectedRevision: second.revision });
      assert.deepEqual([...switched.body.studentIds!].sort(), [...mentees].sort());
      assert.equal(switched.body.scopeConflict!.resolution, "switched");
      assert.deepEqual(switched.body.scope, { basis: "selected", selected: mentees.length }, "a confirmed set is the mentor's from here on");
      assert.equal(switched.status, "ready");
      await assert.rejects(() => planWithAgent(faculty, { request, scopeChoice: "keep" }, { id: switched.id, expectedRevision: switched.revision }), /no open scope question/);

      // ---- L3: an answered question is not asked again ----
      const cycleRequest = "Check attendance this cycle for the students I selected.";
      const cycleBase = { request: cycleRequest, studentIds: [chosen], domain: "attendance" as const, policyId: policy.id };
      const asked = await planWithAgent(faculty, cycleBase, { endpoints: [planEndpoint], chain, commandId: randomUUID() });
      assert.equal(asked.body.questions.length, 1);
      assert.match(asked.body.questions[0]!, /this cycle/);
      const answered = await planWithAgent(faculty, { ...cycleBase, feedback: "The current evaluation cycle; use the latest attendance figures." }, { id: asked.id, expectedRevision: asked.revision, endpoints: [planEndpoint], chain });
      assert.deepEqual(answered.body.questions, [], "the paraphrased question is treated as resolved");
      assert.deepEqual(answered.body.answeredQuestions, asked.body.questions);
      assert.equal(answered.status, "ready");

      // ---- C1: the planner has no rule-based fallback either ----
      const outage = randomUUID();
      await assert.rejects(
        () => planWithAgent(faculty, { request: "Check my mentees' attendance" }, { endpoints: [groqEndpoint(server.url("/down"))], chain, commandId: outage }),
        { code: "AI_UNAVAILABLE", message: /Retry in a moment\. \(groq [^)]*MODEL_HTTP_503\)/ },
      );
      assert.equal(await withCoreTransaction(async (c) => (await c.query("SELECT count(*)::int AS n FROM ch11_plans WHERE id=$1", [outage])).rows[0]!.n), 0, "nothing was saved");
      const audited = await withCoreTransaction(async (c) => (await c.query("SELECT detail->'output' AS output FROM ch11_events WHERE subject_id=$1 AND event_type='planner.unavailable'", [outage])).rows);
      assert.equal(audited.length, 1);
      assert.match(audited[0]!.output.reasons.join(" "), /MODEL_HTTP_503/);
      assert.ok(planner.requests.every((r) => !r.raw.includes(student) && !r.raw.includes(policy.id)));
    } finally {
      await server.close();
      await closePool();
    }
  },
);
