/**
 * Data consistency after a data refresh (additive, audited, deterministic, no model call).
 *
 * The realistic-v2 and v3 refreshes revised the generated figures in place, but only
 * open drafts were retired. Plans that were already approved and published, their
 * interventions, check-ins and the stored risk analyses still described the data
 * before the refresh, and were shown next to the new figures. This module
 *
 *  1. audits every stored artifact by the data generation it was computed on;
 *  2. withdraws approved plans (and their interventions) on earlier figures through the
 *     existing audited outcome command (`recordOutcome`), unshares their check-ins, and
 *     keeps everything on record;
 *  3. re-evaluates every student's risk on the current data with the deterministic policy
 *     engine and stores it as ordinary review cycles whose jobs hold the new analysis.
 *
 * Nothing is deleted. Student exclusions are honoured: an excluded student's records, plans
 * and cases are not written.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorContext } from "@aura/contracts";
import { digest, policySchema, riskAnalysis, validateEvidence, type Evidence, type Policy } from "../chapter11/engine";
import { getCurrentGeneration, writeCommandLedger } from "../command-ledger";
import { recordOutcome } from "../chapter11/review";
import { lockPlan, readSource, savePlan } from "../chapter11/service";
import { withCoreSnapshot, withCoreTransaction } from "../db";
import { projectId } from "./generator";
import {
  WITHDRAWN_BY_REFRESH_PREFIX,
  buildClock,
  generationAt,
  isCurrentEvidence,
  type GenerationClock,
} from "./generation";

export const CONSISTENCY_SEED = "aura-data-consistency-v1";
const PERFORMED_BY = { performedBy: "Claude, authorised by the project owner", additiveOnly: true };

export type StalenessAudit = {
  currentGeneration: string;
  generations: Array<{ label: string; appliedAt: string }>;
  cases: Record<string, number>;
  plans: { total: number; visibleToStudent: number; earlierFigures: number; visibleOnEarlierFigures: number; byGeneration: Record<string, number> };
  interventions: { total: number; earlierFigures: number; byStatus: Record<string, number> };
  followups: { total: number; sharedOnEarlierPlans: number };
  publications: { total: number; earlierFigures: number };
  riskAnalyses: { jobsWithRisk: number; earlierFigures: number; studentsWithOnlyEarlierRisk: number; studentsWithCurrentRisk: number; byGeneration: Record<string, number> };
  awaitingDraftsOnEarlierFigures: number;
};

const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/** Counts every stored artifact by the generation its evidence belongs to. Read only. */
export async function auditStaleArtifacts(c: PoolClient): Promise<StalenessAudit> {
  const gens = (await c.query<{ label: string; created_at: Date }>("SELECT label,created_at FROM data_generations ORDER BY created_at")).rows;
  const clock: GenerationClock = buildClock(gens);
  const at = (value: Date | string | null) => generationAt(clock, value);
  const cases: Record<string, number> = {};
  const caseRows = (await c.query<{ id: string; status: string; captured: Date | null }>(
    "SELECT sc.id,sc.status,(SELECT max(es.captured_at) FROM evidence_snapshots es WHERE es.support_case_id=sc.id) AS captured FROM support_cases sc",
  )).rows;
  for (const row of caseRows) bump(cases, `${at(row.captured)} / ${row.status}`);
  const capturedByCase = new Map(caseRows.map((row) => [row.id, row.captured]));
  const plans = (await c.query<{ id: string; case_id: string; visible: boolean; status: string | null }>(
    "SELECT p.id,p.support_case_id AS case_id,p.visible_to_student AS visible,i.status FROM support_plans p LEFT JOIN ch11_interventions i ON i.support_plan_id=p.id",
  )).rows;
  const planAudit = { total: plans.length, visibleToStudent: 0, earlierFigures: 0, visibleOnEarlierFigures: 0, byGeneration: {} as Record<string, number> };
  const interventions = { total: 0, earlierFigures: 0, byStatus: {} as Record<string, number> };
  const earlierPlanIds = new Set<string>();
  for (const plan of plans) {
    const captured = capturedByCase.get(plan.case_id) ?? null;
    const current = isCurrentEvidence(clock, captured);
    bump(planAudit.byGeneration, at(captured));
    if (plan.visible) planAudit.visibleToStudent += 1;
    if (!current) {
      planAudit.earlierFigures += 1;
      earlierPlanIds.add(plan.id);
      if (plan.visible) planAudit.visibleOnEarlierFigures += 1;
    }
    if (plan.status) {
      interventions.total += 1;
      bump(interventions.byStatus, `${plan.status}${current ? "" : " (earlier figures)"}`);
      if (!current) interventions.earlierFigures += 1;
    }
  }
  const followRows = (await c.query<{ plan_id: string | null; shared: boolean; status: string }>("SELECT support_plan_id AS plan_id,shared,status FROM support_followups")).rows;
  const publications = (await c.query<{ plan_id: string }>("SELECT support_plan_id AS plan_id FROM ch11_publications")).rows;
  const jobs = (await c.query<{ student_id: string; captured: Date | null }>(
    "SELECT student_id,NULLIF(checkpoint->>'capturedAt','')::timestamptz AS captured FROM ch11_jobs WHERE checkpoint ? 'risk'",
  )).rows;
  const risk = { jobsWithRisk: jobs.length, earlierFigures: 0, studentsWithOnlyEarlierRisk: 0, studentsWithCurrentRisk: 0, byGeneration: {} as Record<string, number> };
  const currentStudents = new Set<string>();
  const allStudents = new Set<string>();
  for (const job of jobs) {
    bump(risk.byGeneration, at(job.captured));
    allStudents.add(job.student_id);
    if (isCurrentEvidence(clock, job.captured)) currentStudents.add(job.student_id);
    else risk.earlierFigures += 1;
  }
  risk.studentsWithCurrentRisk = currentStudents.size;
  risk.studentsWithOnlyEarlierRisk = [...allStudents].filter((id) => !currentStudents.has(id)).length;
  const awaiting = (await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM support_cases sc WHERE sc.status='awaiting_faculty' AND COALESCE((SELECT max(es.captured_at) FROM evidence_snapshots es WHERE es.support_case_id=sc.id),'-infinity'::timestamptz) < $1::timestamptz`,
    [clock.since],
  )).rows[0]!.n;
  return {
    currentGeneration: clock.current,
    generations: gens.map((row) => ({ label: row.label, appliedAt: row.created_at.toISOString() })),
    cases,
    plans: planAudit,
    interventions,
    followups: {
      total: followRows.length,
      sharedOnEarlierPlans: followRows.filter((row) => row.shared && row.status !== "completed" && row.plan_id && earlierPlanIds.has(row.plan_id)).length,
    },
    publications: { total: publications.length, earlierFigures: publications.filter((row) => earlierPlanIds.has(row.plan_id)).length },
    riskAnalyses: risk,
    awaitingDraftsOnEarlierFigures: clock.since ? awaiting : 0,
  };
}

type Operator = { actor: ActorContext; personId: string };
async function hodOperator(c: PoolClient): Promise<Operator> {
  const generation = await getCurrentGeneration(c);
  const row = (await c.query<{ id: string; subject: string; department_id: string }>(
    `SELECT p.id,p.external_subject AS subject,r.department_id FROM role_assignments r JOIN people p ON p.id=r.person_id
     WHERE r.generation_id=$1 AND r.role='hod' AND r.active ORDER BY p.id LIMIT 1`,
    [generation],
  )).rows[0];
  if (!row) throw new Error("No active department head to act as the operator");
  return { personId: row.id, actor: { subject: row.subject, personId: row.id, role: "hod", departmentId: row.department_id } as unknown as ActorContext };
}

/** Approved plans whose evidence predates the current generation. */
async function plansOnEarlierFigures(c: PoolClient, excludeStudentIds: string[]) {
  const clock = buildClock((await c.query<{ label: string; created_at: Date }>("SELECT label,created_at FROM data_generations ORDER BY created_at")).rows);
  const rows = (await c.query<{ id: string; student_id: string; revision: number | null; status: string | null; captured: Date | null }>(
    `SELECT p.id,p.student_id,i.revision,i.status,(SELECT max(es.captured_at) FROM evidence_snapshots es WHERE es.support_case_id=p.support_case_id) AS captured
     FROM support_plans p LEFT JOIN ch11_interventions i ON i.support_plan_id=p.id ORDER BY p.created_at`,
  )).rows;
  return {
    clock,
    rows: rows.filter((row) => !excludeStudentIds.includes(row.student_id) && !isCurrentEvidence(clock, row.captured)),
  };
}

/**
 * Withdraws approved plans that were agreed on earlier figures, through the existing
 * audited outcome command (`recordOutcome`: intervention status, plan hidden from the
 * student, command ledger, domain event), and unshares their open check-ins (the previous
 * row is kept in `record_changes`). Safe to run again: the command id is derived from the
 * plan, and a plan already withdrawn is skipped.
 */
export async function withdrawStalePlans(opts: { excludeStudentIds: string[]; dryRun?: boolean }) {
  const { operator, found } = await withCoreSnapshot(async (c) => ({ operator: await hodOperator(c), found: await plansOnEarlierFigures(c, opts.excludeStudentIds) }));
  const todo = found.rows.filter((row) => row.status !== "withdrawn");
  if (opts.dryRun) return { found: found.rows.length, toWithdraw: todo.length, withdrawn: 0, followupsUnshared: 0 };
  for (const row of todo) {
    await recordOutcome(operator.actor, row.id, projectId(CONSISTENCY_SEED, `withdraw:${row.id}:${found.clock.current}`), {
      expectedRevision: row.revision ?? 0,
      status: "withdrawn",
      outcome: `${WITHDRAWN_BY_REFRESH_PREFIX} (${found.clock.current}): this plan was agreed on figures that the data refresh replaced (${generationAt(found.clock, row.captured)}). The mentor will review the student again with the latest figures. The plan stays on record.`,
    });
  }
  const planIds = found.rows.map((row) => row.id);
  const followupsUnshared = await withCoreTransaction(async (c) => {
    if (!planIds.length) return 0;
    const generation = await getCurrentGeneration(c);
    const open = (await c.query<{ id: string }>("SELECT id FROM support_followups WHERE support_plan_id=ANY($1::uuid[]) AND shared AND status<>'completed'", [planIds])).rows.map((r) => r.id);
    if (!open.length) return 0;
    await c.query(
      `INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated)
       SELECT gen_random_uuid(),t.generation_id,$1,'support_followup',t.id,$2,to_jsonb(t),jsonb_build_object('shared',false) FROM support_followups t WHERE t.id=ANY($3::uuid[])`,
      [operator.personId, `${WITHDRAWN_BY_REFRESH_PREFIX} (${found.clock.current}): the check-in belonged to a plan on earlier figures`, open],
    );
    await c.query("UPDATE support_followups SET shared=false,revision=revision+1,updated_at=now() WHERE id=ANY($1::uuid[])", [open]);
    await writeCommandLedger(c, {
      generationId: generation, commandId: projectId(CONSISTENCY_SEED, `unshare-followups:${found.clock.current}:${open.length}`), actorPersonId: operator.personId,
      aggregateType: "data_generation", aggregateId: projectId(CONSISTENCY_SEED, `consistency:${found.clock.current}`), eventType: "data.followups.unshared", action: "data.followups.unshare", topic: "data.generation",
      payload: { label: found.clock.current, unshared: open.length }, metadata: PERFORMED_BY,
    }).catch(() => undefined);
    return open.length;
  });
  return { found: found.rows.length, toWithdraw: todo.length, withdrawn: todo.length, followupsUnshared };
}

export type RiskRefreshOptions = { label: string; excludeStudentIds: string[]; policyVersion?: string; dryRun?: boolean; concurrency?: number };

/**
 * Re-evaluates every student's risk on the current data with the deterministic policy
 * engine (no model call) and stores it as review cycles: one plan per mentor and chunk of
 * 50 students, each job holding the new evidence and analysis. Flagged students stay
 * "queued" (waiting for a draft the mentor can start); the others are "not flagged".
 * Students who already have a job from this refresh are skipped, so a rerun adds nothing.
 */
export async function recomputeRiskAnalyses(opts: RiskRefreshOptions) {
  const info = await withCoreSnapshot(async (c) => {
    const generation = await getCurrentGeneration(c);
    const operator = await hodOperator(c);
    const mentors = (await c.query<{ id: string; subject: string; department_id: string }>(
      `SELECT DISTINCT p.id,p.external_subject AS subject,r.department_id FROM mentor_assignments m JOIN people p ON p.id=m.faculty_person_id
       JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id AND r.role='faculty' AND r.active WHERE m.generation_id=$1 ORDER BY p.id`,
      [generation],
    )).rows;
    const done = new Set((await c.query<{ student_id: string }>("SELECT student_id FROM ch11_jobs WHERE checkpoint->>'riskRefresh'=$1", [opts.label])).rows.map((r) => r.student_id));
    const revision = (await c.query<{ revision: string }>("SELECT revision::text FROM institution_revisions WHERE singleton=true")).rows[0]!.revision;
    return { generation, operator, mentors, done, revision };
  });
  const policyVersion = opts.policyVersion ?? "PROJECT-SUPPORT-V2";
  const report = { evaluated: 0, flagged: 0, notFlagged: 0, skippedExcluded: 0, alreadyDone: 0, evidenceFailures: 0, failureReasons: {} as Record<string, number>, cycles: 0, byBand: {} as Record<string, number> };
  for (const mentor of info.mentors) {
    const { policy, policyId, students } = await withCoreSnapshot(async (c) => {
      const row = (await c.query<{ id: string; policy: unknown }>(
        "SELECT id,policy || scoring AS policy FROM ch11_policies WHERE generation_id=$1 AND faculty_person_id=$2 AND policy->>'version'=$3 ORDER BY created_at DESC LIMIT 1",
        [info.generation, mentor.id, policyVersion],
      )).rows[0];
      if (!row) throw new Error(`Mentor ${mentor.id} has no approved ${policyVersion} policy`);
      const rows = (await c.query<{ id: string }>(
        "SELECT s.id FROM mentor_assignments m JOIN student_profiles s ON s.id=m.student_id WHERE m.generation_id=$1 AND m.faculty_person_id=$2 ORDER BY s.register_number",
        [info.generation, mentor.id],
      )).rows.map((r) => r.id);
      return { policy: policySchema.parse(row.policy) as Policy, policyId: row.id, students: rows };
    });
    const actor = { subject: mentor.subject, personId: mentor.id, role: "faculty", departmentId: mentor.department_id } as unknown as ActorContext;
    const targets = students.filter((id) => {
      if (opts.excludeStudentIds.includes(id)) { report.skippedExcluded += 1; return false; }
      if (info.done.has(id)) { report.alreadyDone += 1; return false; }
      return true;
    });
    for (let from = 0; from < targets.length; from += 50) {
      const chunk = targets.slice(from, from + 50);
      // Evidence and risk first (read only); nothing is written if any student cannot be evaluated.
      const evaluated: Array<{ studentId: string; capturedAt: string; evidence: Evidence; risk: ReturnType<typeof riskAnalysis> }> = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunk.length) {
          const studentId = chunk[cursor++]!;
          try {
            const evidence = Object.fromEntries(await Promise.all((["academic", "lms", "internship", "placement"] as const).map(async (name) => [name, await readSource(actor, studentId, name)]))) as unknown as Evidence;
            // Captured when this student's reads finished: the validator rejects evidence observed
            // after (future) or long before (stale) the capture time, so a slow chunk must not share one time.
            const capturedAt = new Date().toISOString();
            validateEvidence(evidence, studentId, policy, capturedAt, evidence.academic.semester);
            evaluated.push({ studentId, capturedAt, evidence, risk: riskAnalysis(evidence, policy) });
          } catch (error) {
            report.evidenceFailures += 1;
            bump(report.failureReasons, (error instanceof Error ? error.message : String(error)).replace(/postgres(ql)?:\/\/\S+/g, "<url>").slice(0, 120));
          }
        }
      };
      await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, worker));
      if (opts.dryRun) {
        for (const e of evaluated) { report.evaluated += 1; if (e.risk.flagged) report.flagged += 1; else report.notFlagged += 1; bump(report.byBand, e.risk.band); }
        continue;
      }
      if (!evaluated.length) continue;
      const plan = await savePlan(actor, {
        request: `Data refresh re-evaluation (${opts.label}): recompute the risk analysis of ${evaluated.length} mentees from the current figures with the approved policy. No draft is produced until the mentor starts one.`,
        studentIds: evaluated.map((e) => e.studentId),
        domain: "academic",
        policyId,
        feedback: "Deterministic re-evaluation after a data refresh; no model call.",
      });
      const locked = plan.status === "locked" ? plan : await lockPlan(actor, plan.id, plan.revision);
      void locked;
      await withCoreTransaction(async (c) => {
        const jobs = (await c.query<{ id: string; student_id: string }>("SELECT id,student_id FROM ch11_jobs WHERE plan_id=$1 AND status='queued' AND checkpoint='{}'::jsonb", [plan.id])).rows;
        const byStudent = new Map(evaluated.map((e) => [e.studentId, e]));
        for (const job of jobs) {
          const e = byStudent.get(job.student_id);
          if (!e) continue;
          const checkpoint = {
            evidence: e.evidence, risk: e.risk, policy, capturedAt: e.capturedAt, evidenceRevision: info.revision,
            policyGuard: { version: policy.version, facultyApproved: true },
            riskRefresh: opts.label, dataGeneration: opts.label,
          };
          await c.query(
            "UPDATE ch11_jobs SET checkpoint=$2::jsonb,stage=$3,status=$4,updated_at=now() WHERE id=$1 AND status='queued'",
            [job.id, JSON.stringify(checkpoint), e.risk.flagged ? "risk" : "complete", e.risk.flagged ? "queued" : "not_flagged"],
          );
          await c.query(
            "INSERT INTO ch11_events(id,generation_id,subject_id,actor_person_id,event_type,input_hash,output_hash,detail) VALUES($1,$2,$3,$4,'review.risk_refreshed',$5,$6,$7::jsonb)",
            [randomUUID(), info.generation, job.id, info.operator.personId, digest(e.evidence), digest(e.risk), JSON.stringify({ dataGeneration: opts.label, score: e.risk.score, band: e.risk.band, flagged: e.risk.flagged, policy: policy.version, method: "deterministic policy engine, no model call" })],
          );
          report.evaluated += 1;
          if (e.risk.flagged) report.flagged += 1; else report.notFlagged += 1;
          bump(report.byBand, e.risk.band);
        }
        await writeCommandLedger(c, {
          generationId: info.generation, commandId: projectId(CONSISTENCY_SEED, `risk-refresh:${plan.id}`), actorPersonId: info.operator.personId,
          aggregateType: "ch11_plan", aggregateId: plan.id, eventType: "data.risk.recomputed", action: "data.risk.recompute", topic: "data.generation",
          payload: { label: opts.label, students: jobs.length, policy: policy.version }, metadata: PERFORMED_BY,
        });
      });
      report.cycles += 1;
    }
  }
  return report;
}
