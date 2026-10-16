import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { portalOidcClients, type ActorContext } from "@aura/contracts";
import {
  BASELINE_GENERATION,
  STUDENT_REREVIEW_NOTICE,
  WITHDRAWN_BY_REFRESH_PREFIX,
  buildClock,
  currentEvidenceSql,
  generationAt,
  guardPlansForFamily,
  isCurrentEvidence,
  stampEvidence,
} from "../lib/data-refresh/generation";

// A stored artifact (plan, draft, risk analysis) belongs to the data generation that was
// current when its evidence was captured. These tests fail if an artifact from an earlier
// generation can reach a student, a parent or a metric view.

const clock = buildClock([
  { label: "realistic-v2", created_at: "2026-10-14T19:53:10Z" },
  { label: "realistic-v3", created_at: "2026-10-14T21:20:41Z" },
]);

test("generation clock: label at a time, current label, and current evidence", () => {
  assert.equal(clock.current, "realistic-v3");
  assert.equal(generationAt(clock, "2026-10-12T10:00:00Z"), BASELINE_GENERATION);
  assert.equal(generationAt(clock, "2026-10-14T20:00:00Z"), "realistic-v2");
  assert.equal(generationAt(clock, "2026-10-14T21:21:00Z"), "realistic-v3");
  assert.equal(isCurrentEvidence(clock, "2026-10-14T21:21:00Z"), true);
  assert.equal(isCurrentEvidence(clock, "2026-10-14T20:00:00Z"), false);
  assert.equal(isCurrentEvidence(clock, "2026-10-12T10:00:00Z"), false);
  // Nothing captured yet (a queued review) collects today's figures when it runs.
  assert.equal(isCurrentEvidence(clock, null), true);
  // A database that never had a refresh has one generation: everything is current.
  const none = buildClock([]);
  assert.equal(none.current, BASELINE_GENERATION);
  assert.equal(isCurrentEvidence(none, "2020-01-01T00:00:00Z"), true);
});

test("stampEvidence labels a row with its generation", () => {
  const old = stampEvidence(clock, { id: "a", evidence_captured_at: "2026-10-12T10:54:48Z" });
  assert.deepEqual([old.evidence_generation, old.evidence_current], [BASELINE_GENERATION, false]);
  const fresh = stampEvidence(clock, { id: "b", evidence_captured_at: "2026-10-14T23:08:33Z" });
  assert.deepEqual([fresh.evidence_generation, fresh.evidence_current], ["realistic-v3", true]);
});

test("a student or parent never receives a plan on earlier figures; they get one calm line", () => {
  const plan = (id: string, captured: string, visible = true, outcome: string | null = null) => ({
    id, visible, intervention_outcome: outcome, ...stampEvidence(clock, { evidence_captured_at: captured }),
  });
  const old = plan("old", "2026-10-12T10:54:48Z");
  const fresh = plan("fresh", "2026-10-14T23:08:33Z");
  const onlyOld = guardPlansForFamily([old]);
  assert.deepEqual(onlyOld.plans, []);
  assert.equal(onlyOld.notice, STUDENT_REREVIEW_NOTICE);
  assert.equal(STUDENT_REREVIEW_NOTICE, "Your mentor will review your plan again with the latest figures.");
  const mixed = guardPlansForFamily([old, fresh]);
  assert.deepEqual(mixed.plans.map((p) => p.id), ["fresh"]);
  assert.equal(mixed.notice, null);
  // Withdrawn by a data refresh (hidden from the student by the audited command): same line.
  const withdrawn = plan("withdrawn", "2026-10-12T10:54:48Z", false, `${WITHDRAWN_BY_REFRESH_PREFIX} (realistic-v3): ...`);
  assert.equal(guardPlansForFamily([withdrawn]).notice, STUDENT_REREVIEW_NOTICE);
  // Withdrawn by the mentor for another reason: nothing is said.
  const rolledBack = plan("rolled", "2026-10-14T23:08:33Z", false, "Rolled back by the mentor after the check-in");
  assert.deepEqual(guardPlansForFamily([rolledBack]), { plans: [], notice: null });
  // A plan the mentor never published stays unseen.
  assert.deepEqual(guardPlansForFamily([plan("draft", "2026-10-14T23:08:33Z", false)]).plans, []);
});

test("after a second approval the student and parent see only the newest plan", () => {
  const plan = (id: string, created: string, visible = true) => ({
    id, visible, created_at: created, intervention_outcome: null,
    ...stampEvidence(clock, { evidence_captured_at: "2026-10-14T23:08:33Z" }),
  });
  const first = plan("first", "2026-10-15T09:00:00Z");
  const second = plan("second", "2026-10-16T09:00:00Z");
  for (const rows of [[second, first], [first, second]])
    assert.deepEqual(guardPlansForFamily(rows), { plans: [second], notice: null });
  // A newer plan the mentor withdrew does not hide the one still shared.
  assert.deepEqual(guardPlansForFamily([plan("withdrawn", "2026-10-17T09:00:00Z", false), first]).plans, [first]);
  // A newer plan on current figures wins over an older one on earlier figures, and the
  // older one is never shown on its own.
  const earlier = { ...plan("earlier", "2026-10-13T09:00:00Z"), ...stampEvidence(clock, { evidence_captured_at: "2026-10-12T10:54:48Z" }) };
  assert.deepEqual(guardPlansForFamily([earlier, first]).plans, [first]);
});

test("metric and risk queries share one current-evidence predicate", () => {
  assert.equal(
    currentEvidenceSql("x", "$4"),
    "($4::timestamptz IS NULL OR x IS NULL OR x >= $4::timestamptz)",
  );
});

// Opt-in: needs a disposable schema (aura_core_test_consistency*) on a reachable PostgreSQL;
// never point it at a project or deployed schema.
test(
  "database: student, parent, staff and metric views never mix generations",
  { skip: process.env.RUN_CONSISTENCY_DB_TESTS !== "1", timeout: 180000 },
  async () => {
    assert.match(process.env.CORE_DATABASE_SCHEMA ?? "", /^aura_core_test_consistency/);
    const { migrateCoreDatabase } = await import("../lib/migrations");
    const { resetSyntheticSeed } = await import("../lib/reset");
    const { closePool, withCoreTransaction } = await import("../lib/db");
    const { getCurrentGeneration } = await import("../lib/command-ledger");
    const { experienceStudent } = await import("../lib/experience-queries");
    const { overview } = await import("../lib/chapter11/service");
    const { reviewQueue } = await import("../lib/chapter11/review");
    try {
      await migrateCoreDatabase();
      await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1", "consistency-isolated-test");
      const world = await withCoreTransaction(async (c) => {
        const generation = await getCurrentGeneration(c);
        const people = (await c.query<{ id: string; email: string; department_id: string }>(
          "SELECT p.id,p.email,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1",
          [generation],
        )).rows;
        const person = (email: string) => people.find((p) => p.email === email)!;
        const make = (email: string, role: ActorContext["role"], extra: Record<string, unknown> = {}) =>
          ({ subject: email, role, displayName: email, email, clientId: portalOidcClients[role], personId: person(email).id, departmentId: person(email).department_id, ...extra }) as ActorContext;
        const student = (await c.query<{ id: string }>("SELECT id FROM student_profiles WHERE generation_id=$1 AND person_id=$2", [generation, person("student1@aura.invalid").id])).rows[0]!.id;
        const parent = (await c.query<{ parent_person_id: string; email: string; department_id: string | null; supported: boolean }>(
          `SELECT l.parent_person_id,p.email,(SELECT r.department_id FROM role_assignments r WHERE r.person_id=p.id LIMIT 1) AS department_id,
                  EXISTS(SELECT 1 FROM parent_field_grants g WHERE g.parent_link_id=l.id AND g.field_group='support' AND g.granted) AS supported
           FROM parent_links l JOIN people p ON p.id=l.parent_person_id WHERE l.generation_id=$1 AND l.student_id=$2 AND l.active LIMIT 1`,
          [generation, student],
        )).rows[0];
        return {
          generation, student, faculty: make("faculty1@aura.invalid", "faculty"), hod: make("hod.cse@aura.invalid", "hod"), studentActor: make("student1@aura.invalid", "student", { studentId: student }),
          parentActor: parent?.supported ? ({ subject: parent.email, role: "parent", displayName: parent.email, email: parent.email, clientId: portalOidcClients.parent, personId: parent.parent_person_id, departmentId: parent.department_id ?? undefined } as ActorContext) : null,
          facultyId: person("faculty1@aura.invalid").id, departmentId: person("faculty1@aura.invalid").department_id,
        };
      });
      // Two refreshes: the first applied three days ago, the second (current) one day ago.
      await withCoreTransaction(async (c) => {
        for (const [label, days] of [["gen-a", 3], ["gen-b", 1]] as const)
          await c.query(
            "INSERT INTO data_generations(id,generation_id,label,seed,as_of,supersedes_label,summary,created_at) VALUES(gen_random_uuid(),$1,$2,'test',now(),NULL,'{}'::jsonb,now()-($3||' days')::interval)",
            [world.generation, label, String(days)],
          );
      });
      const addPlan = (captured: string, jobRisk: number) =>
        withCoreTransaction(async (c) => {
          const g = world.generation, ids = { c: randomUUID(), s: randomUUID(), r: randomUUID(), a: randomUUID(), d: randomUUID(), p: randomUUID(), cp: randomUUID(), j: randomUUID() };
          await c.query("INSERT INTO support_cases(id,generation_id,student_id,source,status,risk_band,reason) VALUES($1,$2,$3,'test','approved','medium','Consistency test')", [ids.c, g, world.student]);
          await c.query("INSERT INTO evidence_snapshots(id,generation_id,support_case_id,institution_revision,input_hash,evidence,captured_at) VALUES($1,$2,$3,1,'h','{}'::jsonb,now()-($4||' hours')::interval)", [ids.s, g, ids.c, captured]);
          await c.query("INSERT INTO agent_runs(id,generation_id,support_case_id,evidence_snapshot_id,mode,status) VALUES($1,$2,$3,$4,'model','validated')", [ids.r, g, ids.c, ids.s]);
          await c.query("INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,1,'h','{}'::jsonb,'{}'::jsonb)", [ids.a, g, ids.r]);
          await c.query("INSERT INTO faculty_decisions(id,generation_id,support_case_id,agent_artifact_id,faculty_person_id,decision,rationale) VALUES($1,$2,$3,$4,$5,'approved','Consistency test')", [ids.d, g, ids.c, ids.a, world.facultyId]);
          await c.query("INSERT INTO support_plans(id,generation_id,support_case_id,faculty_decision_id,student_id,plan) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [ids.p, g, ids.c, ids.d, world.student, JSON.stringify({ summary: `plan ${captured}`, actions: [], citations: [] })]);
          await c.query("INSERT INTO ch11_plans(id,generation_id,created_by,department_id,status,body,plan_hash) VALUES($1,$2,$3,$4,'locked',$5::jsonb,'h')", [ids.cp, g, world.facultyId, world.departmentId, JSON.stringify({ studentIds: [world.student] })]);
          const checkpoint = { capturedAt: new Date(Date.now() - Number(captured) * 3600000).toISOString(), risk: { score: jobRisk, band: "medium", flagged: true, signals: [], policyVersion: "t" } };
          await c.query("INSERT INTO ch11_jobs(id,generation_id,plan_id,student_id,faculty_person_id,status,stage,checkpoint) VALUES($1,$2,$3,$4,$5,'not_flagged','complete',$6::jsonb)", [ids.j, g, ids.cp, world.student, world.facultyId, JSON.stringify(checkpoint)]);
          return ids.p;
        });
      // "60" hours ago is before the current generation (24 hours ago); "2" hours ago is after it.
      const oldPlan = await addPlan("60", 11);
      const family = async () => {
        const out = [await experienceStudent(world.studentActor, world.student)];
        if (world.parentActor) out.push(await experienceStudent(world.parentActor, world.student));
        return out;
      };
      for (const detail of await family()) {
        assert.deepEqual(detail.support, [], "a plan on earlier figures must not reach a student or parent");
        assert.equal(detail.support_notice, STUDENT_REREVIEW_NOTICE);
      }
      const staff = await experienceStudent(world.faculty, world.student);
      assert.equal(staff.support.length, 1);
      assert.equal(staff.support[0]!.evidence_current, false);
      assert.equal(staff.support[0]!.evidence_generation, "gen-a");
      const queueBefore = await reviewQueue(world.faculty);
      assert.equal((queueBefore.plans as Array<{ id: string; evidence_current: boolean }>).find((p) => p.id === oldPlan)!.evidence_current, false);
      // Risk view, trends and AI-activity metrics read the current generation only.
      const emptyView = await overview(world.faculty);
      assert.equal(emptyView.riskView.filter((r: { score: number | null }) => r.score === 11).length, 0, "an earlier risk score must not appear in the risk view");
      assert.equal(emptyView.dataGeneration.earlierReviews >= 1, true);
      const freshPlan = await addPlan("2", 33);
      for (const detail of await family()) {
        assert.deepEqual(detail.support.map((p) => p.id), [freshPlan]);
        assert.equal(detail.support_notice, null);
      }
      const view = await overview(world.faculty);
      const scores = view.riskView.map((r: { score: number | null }) => r.score);
      assert.ok(scores.includes(33) && !scores.includes(11), "only the current risk analysis is read");
      assert.equal(view.metrics.totals.jobs, view.jobs.length);
      assert.ok(view.jobs.every((j: { risk: { score: number } | null }) => j.risk?.score !== 11));
      assert.ok(view.trends.every((t: { reviewed: number }) => t.reviewed >= 1));

      // Review R-05: a draft on earlier figures can be declined, never approved (the
      // family guard would hide the plan while the mentor was told it was shared).
      const { decideSupportCase } = await import("../lib/support-commands");
      const hash = "a".repeat(64);
      const draftCaptured = (hoursAgo: string) =>
        withCoreTransaction(async (c) => {
          const g = world.generation, ids = { c: randomUUID(), s: randomUUID(), r: randomUUID(), a: randomUUID() };
          await c.query("INSERT INTO support_cases(id,generation_id,student_id,source,status,risk_band,reason) VALUES($1,$2,$3,'test','awaiting_faculty','medium','Consistency test')", [ids.c, g, world.student]);
          await c.query("INSERT INTO evidence_snapshots(id,generation_id,support_case_id,institution_revision,input_hash,evidence,captured_at) VALUES($1,$2,$3,1,'h',$4::jsonb,now()-($5||' hours')::interval)", [ids.s, g, ids.c, JSON.stringify({ assignedFacultyPersonId: world.facultyId }), hoursAgo]);
          await c.query("INSERT INTO agent_runs(id,generation_id,support_case_id,evidence_snapshot_id,mode,status) VALUES($1,$2,$3,$4,'model','validated')", [ids.r, g, ids.c, ids.s]);
          await c.query("INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,1,$4,'{}'::jsonb,'{\"valid\":true}'::jsonb)", [ids.a, g, ids.r, hash]);
          return { caseId: ids.c, artifactId: ids.a };
        });
      const decide = (draft: { caseId: string; artifactId: string }, decision: "approved" | "rejected") =>
        decideSupportCase(world.faculty, draft.caseId, randomUUID(), { artifactId: draft.artifactId, contentHash: hash, expectedRevision: 0, decision, rationale: "Consistency test decision" });
      const earlierDraft = await draftCaptured("60");
      await assert.rejects(() => decide(earlierDraft, "approved"), (error: unknown) => (error as { code?: string }).code === "EVIDENCE_EARLIER_FIGURES");
      assert.equal((await decide(earlierDraft, "rejected")).supportCase.status, "rejected");
      const currentDraft = await draftCaptured("2");
      assert.ok((await decide(currentDraft, "approved")).plan, "a draft on current figures is approved as before");

      // Review R-10: the department head sees every decision per mentor, declines included
      // (two approved plans above, one declined and one approved draft).
      type Decided = { faculty_person_id: string; decisions: number; approved: number; declined: number; last_decided_at: unknown };
      const decided = ((await reviewQueue(world.hod)).mentorDecisions as Decided[]).find((row) => row.faculty_person_id === world.facultyId)!;
      assert.deepEqual([decided.decisions, decided.approved, decided.declined], [4, 3, 1]);
      assert.ok(decided.last_decided_at, "the last decision time includes declines");
      assert.deepEqual((await reviewQueue(world.faculty)).mentorDecisions, []);

      // Review R-06: an open draft leaves the gate once the same student has a newer
      // review that finished (here: checked, no support needed). Read-side only.
      const review = (status: string, caseId: string | null = null) =>
        withCoreTransaction(async (c) => {
          const plan = randomUUID();
          await c.query("INSERT INTO ch11_plans(id,generation_id,created_by,department_id,status,body,plan_hash) VALUES($1,$2,$3,$4,'locked',$5::jsonb,'h')", [plan, world.generation, world.facultyId, world.departmentId, JSON.stringify({ studentIds: [world.student] })]);
          await c.query("INSERT INTO ch11_jobs(id,generation_id,plan_id,student_id,faculty_person_id,status,stage,checkpoint,support_case_id) VALUES($1,$2,$3,$4,$5,$6,'complete','{}'::jsonb,$7)", [randomUUID(), world.generation, plan, world.student, world.facultyId, status, caseId]);
        });
      const gateDraft = await draftCaptured("2");
      await review("awaiting_faculty", gateDraft.caseId);
      const atGate = async () => ((await reviewQueue(world.faculty)).drafts as Array<{ id: string }>).map((d) => d.id);
      assert.deepEqual(await atGate(), [gateDraft.caseId], "a draft from the student's latest review is at the gate");
      await review("queued");
      assert.deepEqual(await atGate(), [gateDraft.caseId], "a newer review that has not run yet changes nothing");
      await review("not_flagged");
      assert.deepEqual(await atGate(), [], "a newer finished review supersedes the older draft");
      assert.equal((await reviewQueue(world.faculty)).awaitingCount, 0);
    } finally {
      await closePool();
    }
  },
);
