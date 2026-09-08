import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { lmsEvidence } from "../lms-queries";
import { withCoreTransaction } from "../db";
import { getCurrentGeneration, writeCommandLedger } from "../command-ledger";
import { ConflictError, NotFoundError } from "../http";
import { AuthorizationError, requireRole } from "../security";
import { hashJson } from "../support-commands";
import { collectSources, compose, DataBlocked, demoPolicy, digest, formatSkill, parallelMap, planInputSchema, planSkill, policySchema, referenceLibrary, retrieve, riskAnalysis, sourceNames, sourceSchema, validateEvidence, type Evidence, type Policy, type Risk, type Source, type SourceName, type Composer, type Reference } from "./engine";
import { configuredComposer } from "./provider";

type PlanBody = ReturnType<typeof planSkill>;
type PlanRow = { id: string; generation_id: string; created_by: string; department_id: string; revision: number; status: string; paused: boolean; body: PlanBody; plan_hash: string };
type Job = { id: string; generation_id: string; plan_id: string; student_id: string; faculty_person_id: string; status: string; stage: string; checkpoint: Checkpoint; lease_token: string; support_case_id: string | null };
type Checkpoint = { evidence?: Evidence; capturedAt?: string; risk?: Risk; retrieval?: ReturnType<typeof retrieve>; composed?: Awaited<ReturnType<typeof compose>>; policy?: Policy };

async function audit(client: PoolClient, generation: string, actor: ActorContext, subject: string, event: string, input: unknown, output: unknown) {
  await client.query("INSERT INTO ch11_events(id,generation_id,subject_id,actor_person_id,event_type,input_hash,output_hash,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)", [randomUUID(), generation, subject, actor.personId, event, digest(input), digest(output), JSON.stringify({ input, output })]);
}
function departmentScope(actor: ActorContext, department: string) {
  requireRole(actor, "faculty", "hod", "governance");
  if (actor.role !== "governance" && actor.departmentId !== department) throw new AuthorizationError("The requested review is outside your department");
}
async function requireAssignedStudents(client: PoolClient, generation: string, facultyId: string, studentIds: string[]) {
  const assigned = await client.query("SELECT student_id FROM mentor_assignments WHERE generation_id=$1 AND faculty_person_id=$2 AND student_id=ANY($3::uuid[])",[generation,facultyId,studentIds]);
  if(assigned.rowCount!==studentIds.length)throw new AuthorizationError("Every student must be assigned to the selected mentor");
}
async function getPlan(client: PoolClient, actor: ActorContext, id: string, lock = false): Promise<PlanRow> {
  z.string().uuid().parse(id);
  const generation = await getCurrentGeneration(client);
  const result = await client.query<PlanRow>(`SELECT * FROM ch11_plans WHERE id=$1 AND generation_id=$2${lock ? " FOR UPDATE" : ""}`, [id, generation]);
  if (!result.rowCount) throw new NotFoundError("Review plan not found");
  const plan = result.rows[0]!;
  departmentScope(actor, plan.department_id);
  if (actor.role === "faculty" && plan.created_by !== actor.personId) {
    const policy = await client.query("SELECT id FROM ch11_policies WHERE id=$1 AND faculty_person_id=$2 AND generation_id=$3", [plan.body.policyId, actor.personId, generation]);
    if (!policy.rowCount) throw new AuthorizationError("This plan belongs to another mentor");
  }
  return plan;
}

export const approvePolicySchema = z.object({ policy: policySchema, facultyId: z.string().uuid().optional(), rationale: z.string().trim().min(12).max(600) }).strict();
export async function approvePolicy(actor: ActorContext, raw: unknown, commandId: string = randomUUID()) {
  requireRole(actor, "faculty", "hod");
  z.string().uuid().parse(commandId);
  const input = approvePolicySchema.parse(raw);
  const owner=input.facultyId??actor.personId;
  if(actor.role==="faculty" && owner!==actor.personId)throw new AuthorizationError("Use your own mentor policy");
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const permitted=await client.query("SELECT id FROM role_assignments WHERE generation_id=$1 AND person_id=$2 AND department_id=$3 AND role='faculty' AND active",[generation,owner,actor.departmentId]);
    if(!permitted.rowCount)throw new AuthorizationError("Choose an active mentor in your department");
    const id = commandId;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
    const prior = await client.query<{ faculty_person_id: string; policy: Policy; rationale: string }>("SELECT faculty_person_id,policy,rationale FROM ch11_policies WHERE id=$1 AND generation_id=$2", [id, generation]);
    if (prior.rowCount) {
      if (prior.rows[0]!.faculty_person_id !== owner || digest({ policy: prior.rows[0]!.policy, rationale: prior.rows[0]!.rationale }) !== digest({policy:input.policy,rationale:input.rationale})) throw new ConflictError("IDEMPOTENCY_KEY_MISMATCH", "This command already approved a different policy");
      return { id, ...input, synthetic: true };
    }
    await client.query("INSERT INTO ch11_policies(id,generation_id,department_id,faculty_person_id,policy,rationale) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [id, generation, actor.departmentId, owner, JSON.stringify(input.policy), input.rationale]);
    await audit(client, generation, actor, id, "policy.approved", input, { id, synthetic: true });
    return { id, ...input, synthetic: true };
  });
}

export async function savePlan(actor: ActorContext, raw: unknown, id?: string, expectedRevision?: number, commandId: string = randomUUID()) {
  requireRole(actor, "faculty", "hod", "governance");
  z.string().uuid().parse(commandId);
  const input = planInputSchema.parse(raw);
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    let department = actor.departmentId;
    if (input.policyId) {
      const policy = await client.query<{ department_id: string; faculty_person_id: string }>("SELECT department_id,faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2", [input.policyId, generation]);
      if (!policy.rowCount) throw new NotFoundError("Approved policy not found");
      department = policy.rows[0]!.department_id;
      departmentScope(actor, department);
      if (actor.role === "faculty" && policy.rows[0]!.faculty_person_id !== actor.personId) throw new AuthorizationError("Use your own approved mentor policy");
      if (input.studentIds) await requireAssignedStudents(client, generation, policy.rows[0]!.faculty_person_id, input.studentIds);
    }
    if (!department) {
      const first = await client.query<{ id: string }>("SELECT id FROM departments WHERE generation_id=$1 ORDER BY code LIMIT 1", [generation]);
      department = first.rows[0]?.id;
    }
    if (!department) throw new ConflictError("DATA_BLOCKED", "No active department is available");
    if (input.studentIds) {
      if (new Set(input.studentIds).size !== input.studentIds.length) throw new ConflictError("DUPLICATE_STUDENT", "Select each student once");
      const found = await client.query("SELECT id FROM student_profiles WHERE generation_id=$1 AND department_id=$2 AND id=ANY($3::uuid[])", [generation, department, input.studentIds]);
      if (found.rowCount !== input.studentIds.length) throw new AuthorizationError("Every student must belong to the policy department");
    }
    const body = planSkill(input);
    if (id) {
      const previous = await getPlan(client, actor, id, true);
      if (previous.status === "locked") throw new ConflictError("PLAN_LOCKED", "A locked plan cannot be edited; create a new plan");
      if (previous.revision !== expectedRevision) throw new ConflictError("STALE_VERSION", "Reload the plan before revising it");
      await client.query("UPDATE ch11_plans SET body=$2::jsonb,department_id=$3,status=$4,revision=revision+1 WHERE id=$1", [id, JSON.stringify(body), department, body.ready ? "ready" : "clarifying"]);
      await audit(client, generation, actor, id, "plan.revised", previous.body, body);
    } else {
      id = commandId;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
      const existing = await client.query<PlanRow>("SELECT * FROM ch11_plans WHERE id=$1 AND generation_id=$2", [id, generation]);
      if (existing.rowCount) {
        if (existing.rows[0]!.created_by !== actor.personId || digest(existing.rows[0]!.body) !== digest(body)) throw new ConflictError("IDEMPOTENCY_KEY_MISMATCH", "This command already created a different plan");
        return existing.rows[0]!;
      }
      await client.query("INSERT INTO ch11_plans(id,generation_id,created_by,department_id,status,body) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [id, generation, actor.personId, department, body.ready ? "ready" : "clarifying", JSON.stringify(body)]);
      await audit(client, generation, actor, id, "plan.created", input, body);
    }
    return getPlan(client, actor, id);
  });
}
export async function lockPlan(actor: ActorContext, id: string, expectedRevision: number) {
  requireRole(actor, "faculty", "hod", "governance");
  return withCoreTransaction(async client => {
    const plan = await getPlan(client, actor, id, true);
    if (plan.status === "locked") return plan;
    if (plan.revision !== expectedRevision) throw new ConflictError("STALE_VERSION", "Reload the plan before locking it");
    if (!plan.body.ready) throw new ConflictError("CLARIFICATION_REQUIRED", "Answer the planning questions before locking");
    const policy = await client.query<{ faculty_person_id: string }>("SELECT faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2", [plan.body.policyId, plan.generation_id]);
    if (!policy.rowCount) throw new ConflictError("POLICY_REQUIRED", "A mentor-approved policy is required");
    await client.query("UPDATE ch11_plans SET status='locked',plan_hash=$2,locked_at=now(),revision=revision+1 WHERE id=$1", [id, digest(plan.body)]);
    for (const student of plan.body.studentIds!) await client.query("INSERT INTO ch11_jobs(id,generation_id,plan_id,student_id,faculty_person_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [randomUUID(), plan.generation_id, id, student, policy.rows[0]!.faculty_person_id]);
    await audit(client, plan.generation_id, actor, id, "plan.locked", plan.body, { hash: digest(plan.body), students: plan.body.studentIds });
    return getPlan(client, actor, id);
  });
}

/** The only four-source access surface used by Chapter 11 workers. */
export async function readSource(actor: ActorContext, studentId: string, source: SourceName): Promise<Source> {
  z.string().uuid().parse(studentId);
  z.enum(sourceNames).parse(source);
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const row = await client.query<{ department_id: string }>("SELECT department_id FROM student_profiles WHERE generation_id=$1 AND id=$2", [generation, studentId]);
    if (!row.rowCount) throw new NotFoundError("Student not found");
    departmentScope(actor, row.rows[0]!.department_id);
    if (actor.role === "faculty") await requireAssignedStudents(client, generation, actor.personId, [studentId]);
    if (source === "lms") return lmsEvidence(client,generation,studentId);
    if (source !== "academic") {
      const record = await client.query<{ record: Source }>("SELECT record FROM ch11_sources WHERE generation_id=$1 AND student_id=$2 AND source=$3", [generation, studentId, source]);
      if (!record.rowCount) throw new DataBlocked([`${source}: no linked authorized record`]);
      return sourceSchema.parse(record.rows[0]!.record);
    }
    const records = await client.query<{ kind: string; value: number; record_id: string; observed_at: Date }>(
      `SELECT 'attendance' AS kind, CASE WHEN r.status IN ('present','late') THEN 100.0 ELSE 0.0 END AS value,r.id::text AS record_id,s.session_date::timestamptz AS observed_at
       FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id
       JOIN course_offerings co ON co.id=s.course_offering_id JOIN terms t ON t.id=co.term_id
       WHERE t.code='2026-ODD' AND t.active AND r.generation_id=$1 AND r.student_id=$2 AND s.status IN ('submitted','locked') AND r.status<>'excused'
       UNION ALL SELECT 'mark', (m.score / NULLIF(a.maximum_score,0) * 100)::float,m.id::text,m.recorded_at
       FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN course_offerings co ON co.id=a.course_offering_id JOIN terms t ON t.id=co.term_id WHERE t.code='2026-ODD' AND t.active AND m.generation_id=$1 AND m.student_id=$2 AND a.published`, [generation, studentId]);
    const attendance = records.rows.filter(r => r.kind === "attendance");
    const marks = records.rows.filter(r => r.kind === "mark");
    const average = (rows: typeof records.rows) => rows.reduce((sum, r) => sum + Number(r.value), 0) / rows.length;
    return sourceSchema.parse({ source, studentId, recordId: records.rows.map(r => r.record_id).sort().join(",") || "missing", observedAt: records.rows.length ? new Date(Math.max(...records.rows.map(r => new Date(r.observed_at).getTime()))).toISOString() : new Date().toISOString(), semester: "2026-ODD", state: attendance.length && marks.length ? "present" : "missing", synthetic: true, values: { ...(attendance.length ? { attendancePct: average(attendance) } : {}), ...(marks.length ? { markPct: average(marks) } : {}) } });
  });
}

export async function seedChapterSources(actor: ActorContext) {
  requireRole(actor, "governance");
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const students = await client.query<{ id: string; register_number: string }>("SELECT id,register_number FROM student_profiles WHERE generation_id=$1 ORDER BY register_number", [generation]);
    let inserted = 0;
    for (const [index, student] of students.rows.entries()) {
      for (const source of ["lms", "internship", "placement"] as const) {
        const id = randomUUID();
        const values = source === "lms" ? { inactivityDays: index % 3 === 0 ? 9 : 2, overdueAssignments: index % 3 === 0 ? 2 : 0 } : source === "internship" ? { missedMilestones: index % 4 === 0 ? 1 : 0 } : { missedActivities: index % 5 === 0 ? 1 : 0 };
        const record = { source, studentId: student.id, recordId: `CH11-SYNTHETIC-${student.register_number}-${source}`, observedAt: new Date().toISOString(), semester: "2026-ODD", state: "present", synthetic: true, values };
        const result = await client.query("INSERT INTO ch11_sources(id,generation_id,student_id,source,record) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING", [id, generation, student.id, source, JSON.stringify(record)]);
        inserted += result.rowCount ?? 0;
      }
    }
    await audit(client, generation, actor, generation, "sources.synthetic_linked", { fixtureVersion: "CH11-SYNTHETIC-1" }, { inserted });
    return { inserted, synthetic: true };
  });
}

async function saveCheckpoint(actor: ActorContext, job: Job, stage: string, checkpoint: Checkpoint) {
  await withCoreTransaction(async client => {
    if (await getCurrentGeneration(client) !== job.generation_id) throw new ConflictError("GENERATION_CHANGED", "The synthetic generation changed during execution");
    const saved = await client.query("UPDATE ch11_jobs SET checkpoint=$2::jsonb,stage=$3,updated_at=now(),lease_until=now()+interval '180 seconds' WHERE id=$1 AND lease_token=$4 AND status='running' RETURNING id", [job.id, JSON.stringify(checkpoint), stage, job.lease_token]);
    if (!saved.rowCount) throw new ConflictError("LEASE_LOST", "Another executor owns this job");
    await audit(client, job.generation_id, actor, job.id, `checkpoint.${stage}`, { stage: job.stage, checkpoint: job.checkpoint }, checkpoint);
  });
  job.checkpoint = checkpoint; job.stage = stage;
}

async function publishDraft(actor: ActorContext, job: Job, plan: PlanRow) {
  return withCoreTransaction(async client => {
    const activePlan=await getPlan(client,actor,plan.id,true);
    if(activePlan.paused)throw new ConflictError("PLAN_PAUSED","Review paused before publishing its suggestion");
    const current = await client.query<Job>("SELECT * FROM ch11_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [job.id, job.lease_token]);
    if (!current.rowCount) throw new ConflictError("LEASE_LOST", "Another executor owns this job");
    if (await getCurrentGeneration(client) !== job.generation_id) throw new ConflictError("GENERATION_CHANGED", "The generation changed");
    await requireAssignedStudents(client, job.generation_id, job.faculty_person_id, [job.student_id]);
    const cp = job.checkpoint;
    if (!cp.risk?.flagged) {
      await client.query("UPDATE ch11_jobs SET status='not_flagged',stage='complete',lease_until=NULL,updated_at=now() WHERE id=$1", [job.id]);
      await audit(client, job.generation_id, actor, job.id, "review.not_flagged", cp, { noRecommendation: true });
      return;
    }
    if (!cp.composed?.validation.valid) throw new ConflictError("VALIDATION_REQUIRED", "A passing acceptance report is required before mentor review");
    const caseId = randomUUID(), snapshotId = randomUUID(), runId = randomUUID(), artifactId = randomUUID();
    const reason = cp.risk.signals.map(s => s.explanation).join(" ");
    const evidence = { ...cp.evidence, assignedFacultyPersonId: job.faculty_person_id, planId: plan.id, planHash: plan.plan_hash, domain: plan.body.domain, policy: cp.policy, risk: cp.risk, retrieval: cp.retrieval, chapterJobId: job.id };
    const inputHash = hashJson(evidence), contentHash = hashJson(cp.composed.packet);
    await client.query("INSERT INTO support_cases(id,generation_id,student_id,source,status,risk_band,reason) VALUES($1,$2,$3,$4,'awaiting_faculty',$5,$6)", [caseId, job.generation_id, job.student_id, `chapter11:${plan.id}`, cp.risk.band, reason]);
    const revision = await client.query<{ revision: string }>("SELECT revision::text FROM institution_revisions WHERE singleton=true");
    await client.query("INSERT INTO evidence_snapshots(id,generation_id,support_case_id,institution_revision,input_hash,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [snapshotId, job.generation_id, caseId, revision.rows[0]!.revision, inputHash, JSON.stringify(evidence)]);
    await client.query("INSERT INTO agent_runs(id,generation_id,support_case_id,evidence_snapshot_id,mode,model_id,status,completed_at) VALUES($1,$2,$3,$4,$5,$6,'validated',now())", [runId, job.generation_id, caseId, snapshotId, cp.composed.mode, cp.composed.modelId]);
    await client.query("INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb)", [artifactId, job.generation_id, runId, contentHash, JSON.stringify(cp.composed.packet), JSON.stringify({ ...cp.composed.validation, policyVersion: cp.policy!.version, chapter11: true })]);
    await client.query("UPDATE ch11_jobs SET status='awaiting_faculty',stage='complete',support_case_id=$2,lease_until=NULL,updated_at=now() WHERE id=$1", [job.id, caseId]);
    await writeCommandLedger(client, { generationId: job.generation_id, commandId: job.id, actorPersonId: actor.personId, aggregateType: "support_case", aggregateId: caseId, eventType: "support.proposed", action: "chapter11_review", topic: "support.proposal.created", payload: { studentId: job.student_id, departmentId: plan.department_id, facultyPersonId: job.faculty_person_id, supportCase: { id: caseId }, runId, artifactId }, metadata: { planId: plan.id, jobId: job.id, inputHash, contentHash } });
    await audit(client, job.generation_id, actor, job.id, "mentor.interrupt", cp, { caseId, runId, artifactId, contentHash });
  });
}

export async function executePlan(actor: ActorContext, planId: string, options: { concurrency?: number; composer?: Composer; stopAfterStage?: string } = {}) {
  requireRole(actor, "faculty", "hod", "governance");
  const start = performance.now();
  const initial = await withCoreTransaction(async client => {
    const plan = await getPlan(client, actor, planId);
    if(plan.paused)throw new ConflictError("PLAN_PAUSED","This review is paused. Resume it before continuing.");
    if (plan.status !== "locked" || digest(plan.body) !== plan.plan_hash) throw new ConflictError("PLAN_NOT_LOCKED", "Lock a valid plan before execution");
    const policy = await client.query<{ policy: Policy; faculty_person_id: string }>("SELECT policy,faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2", [plan.body.policyId, plan.generation_id]);
    if (!policy.rowCount) throw new ConflictError("POLICY_REQUIRED", "Approved policy missing");
    await requireAssignedStudents(client, plan.generation_id, policy.rows[0]!.faculty_person_id, plan.body.studentIds!);
    const jobs = await client.query<{ id: string }>("SELECT id FROM ch11_jobs WHERE plan_id=$1 AND generation_id=$2 AND (status IN ('queued','blocked','failed') OR (status='running' AND lease_until<now())) ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,updated_at,student_id LIMIT 4", [plan.id, plan.generation_id]);
    return { plan, policy: policySchema.parse(policy.rows[0]!.policy), jobs: jobs.rows };
  });
  const results = await parallelMap(initial.jobs, options.concurrency ?? initial.plan.body.budget.concurrency, async ({ id }) => {
    const job = await withCoreTransaction(async client => {
      const plan=await getPlan(client,actor,planId,true);
      if(plan.paused)return undefined;
      const lease = randomUUID();
      const claimed = await client.query<Job>("UPDATE ch11_jobs SET status='running',lease_token=$2,lease_until=now()+interval '180 seconds',attempts=attempts+1,error_code=NULL WHERE id=$1 AND (status IN ('queued','blocked','failed') OR (status='running' AND lease_until<now())) RETURNING *", [id, lease]);
      return claimed.rows[0];
    });
    if (!job) return { id, skipped: true };
    try {
      await ensureReviewRunning(actor,planId);
      if (!job.checkpoint.evidence) {
        const evidence = await collectSources({ read: (student, source) => readSource(actor, student, source) }, job.student_id);
        const capturedAt = new Date().toISOString();
        validateEvidence(evidence, job.student_id, initial.policy, capturedAt, "2026-ODD");
        await saveCheckpoint(actor, job, "risk", { evidence, capturedAt, policy: initial.policy });
      }
      await ensureReviewRunning(actor,planId);
      if (options.stopAfterStage === job.stage) throw new Error("INJECTED_STOP");
      if (!job.checkpoint.risk) {
        const risk = riskAnalysis(job.checkpoint.evidence!, initial.policy);
        const history = await withCoreTransaction(async client => {
          const prior = await client.query<{ id: string; plan: { summary: string } }>("SELECT id,plan FROM support_plans WHERE generation_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 20", [job.generation_id, job.student_id]);
          return prior.rows.map(r => ({ id: r.id, text: r.plan.summary, tags: [initial.plan.body.domain!], studentId: job.student_id, departmentId: initial.plan.department_id } satisfies Reference));
        });
        await saveCheckpoint(actor, job, "recommend", { ...job.checkpoint, risk, retrieval: retrieve(risk.signals.map(s => s.explanation).join(" "), [initial.plan.body.domain!], [...referenceLibrary, ...history], initial.plan.department_id, job.student_id) });
      }
      await ensureReviewRunning(actor,planId);
      if (options.stopAfterStage === job.stage) throw new Error("INJECTED_STOP");
      if (job.checkpoint.risk!.flagged && !job.checkpoint.composed) {
        const provider = initial.plan.body.mode === "model" ? options.composer ?? configuredComposer() : undefined;
        const composed = await compose({ evidence: job.checkpoint.evidence!, risk: job.checkpoint.risk!, domain: initial.plan.body.domain!, references: job.checkpoint.retrieval!, baseline: formatSkill(job.checkpoint.risk!, initial.plan.body.domain!) }, provider);
        if (initial.plan.body.mode === "model" && !provider) { composed.validation.providerError = "MODEL_NOT_CONFIGURED"; composed.validation.fallback = true; }
        await saveCheckpoint(actor, job, "publish", { ...job.checkpoint, composed });
      }
      await ensureReviewRunning(actor,planId);
      if (options.stopAfterStage === job.stage) throw new Error("INJECTED_STOP");
      await publishDraft(actor, job, initial.plan);
      return { id, completed: true };
    } catch (error) {
      const code = error instanceof DataBlocked ? "DATA_BLOCKED" : error instanceof ConflictError ? error.code : error instanceof Error && error.message === "INJECTED_STOP" ? "INJECTED_STOP" : "EXECUTION_FAILED";
      await withCoreTransaction(async client => {
        await client.query("UPDATE ch11_jobs SET status=$2,error_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$4 AND status='running'", [job.id, code === "PLAN_PAUSED" ? "queued" : code === "DATA_BLOCKED" ? "blocked" : "failed", code, job.lease_token]);
        await audit(client, job.generation_id, actor, job.id, "execution.stopped", { stage: job.stage }, { code, reasons: error instanceof DataBlocked ? error.reasons : [] });
      });
      return { id, error: code };
    }
  });
  const report = { planId, elapsedMs: Math.round(performance.now() - start), concurrency: options.concurrency ?? initial.plan.body.budget.concurrency, results };
  await withCoreTransaction(client => audit(client, initial.plan.generation_id, actor, planId, "execution.merged", { studentIds: initial.plan.body.studentIds, planHash: initial.plan.plan_hash }, report));
  return report;
}

export async function overview(actor: ActorContext) {
  requireRole(actor, "faculty", "governance", "hod");
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const department = actor.role === "governance" ? null : actor.departmentId;
    const mentor = actor.role === "faculty" ? actor.personId : null;
    const students = await client.query(`SELECT s.id,s.department_id,s.register_number,p.display_name,m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name FROM student_profiles s JOIN people p ON p.id=s.person_id LEFT JOIN mentor_assignments m ON m.student_id=s.id LEFT JOIN people mp ON mp.id=m.faculty_person_id
      WHERE s.generation_id=$1 AND ($2::uuid IS NULL OR s.department_id=$2) AND ($3::uuid IS NULL OR EXISTS(
      SELECT 1 FROM mentor_assignments m WHERE m.generation_id=s.generation_id AND m.student_id=s.id AND m.faculty_person_id=$3)) ORDER BY s.register_number`, [generation, department, mentor]);
    const policies = await client.query("SELECT * FROM ch11_policies WHERE generation_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND ($3::uuid IS NULL OR faculty_person_id=$3) ORDER BY created_at DESC", [generation, department, mentor]);
    const plans = await client.query("SELECT * FROM ch11_plans WHERE generation_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND ($3::uuid IS NULL OR created_by=$3 OR body->>'policyId' IN (SELECT id::text FROM ch11_policies WHERE faculty_person_id=$3)) ORDER BY created_at DESC", [generation, department, mentor]);
    const jobs = await client.query("SELECT j.id,j.plan_id,j.student_id,j.created_at,j.attempts,j.faculty_person_id,COALESCE((SELECT e.detail->'output'->'reasons' FROM ch11_events e WHERE e.subject_id=j.id AND e.event_type='execution.stopped' ORDER BY e.created_at DESC LIMIT 1),'[]') AS failure_reasons,COALESCE(c.status,j.status) AS status,j.stage,j.error_code,j.support_case_id,j.updated_at,j.checkpoint->'risk' AS risk,j.checkpoint->'composed'->'validation' AS validation,j.checkpoint->'composed'->>'mode' AS mode FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id LEFT JOIN support_cases c ON c.id=j.support_case_id WHERE j.generation_id=$1 AND ($2::uuid IS NULL OR p.department_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=j.student_id AND m.faculty_person_id=$3)) ORDER BY j.created_at DESC", [generation, department, mentor]);
    const trends=await client.query("SELECT date_trunc('day',j.created_at)::date::text AS day,count(*)::int AS reviewed FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id WHERE j.generation_id=$1 AND ($2::uuid IS NULL OR p.department_id=$2) GROUP BY 1 ORDER BY 1",[generation,department]);
    return { trends:trends.rows, students: students.rows, policies: policies.rows, plans: plans.rows, jobs: jobs.rows, demoPolicy, modelConfigured: !!configuredComposer(), synthetic: true };
  });
}

export async function exportPlan(actor: ActorContext, id: string) {
  return withCoreTransaction(async client => {
    const plan = await getPlan(client, actor, id);
    const jobs = await client.query("SELECT * FROM ch11_jobs WHERE plan_id=$1 AND generation_id=$2 ORDER BY student_id", [id, plan.generation_id]);
    const events = await client.query("SELECT * FROM ch11_events WHERE generation_id=$1 AND (subject_id=$2 OR subject_id IN (SELECT id FROM ch11_jobs WHERE plan_id=$2)) ORDER BY created_at,id", [plan.generation_id, id]);
    return { schemaVersion: 1, synthetic: true, plan, jobs: jobs.rows, events: events.rows, exportedAt: new Date().toISOString() };
  });
}

async function ensureReviewRunning(actor:ActorContext,id:string){
  await withCoreTransaction(async client=>{const plan=await getPlan(client,actor,id);if(plan.paused)throw new ConflictError("PLAN_PAUSED","Review paused before the next stage");});
}
export async function setReviewPaused(actor:ActorContext,id:string,raw:unknown){
  requireRole(actor,"hod","faculty","governance");
  const input=z.object({paused:z.boolean(),expectedRevision:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(600)}).strict().parse(raw);
  return withCoreTransaction(async client=>{const plan=await getPlan(client,actor,id,true);if(plan.revision!==input.expectedRevision)throw new ConflictError("STALE_VERSION","Reload this review before changing its status");
    await client.query("UPDATE ch11_plans SET paused=$2,revision=revision+1 WHERE id=$1",[id,input.paused]);
    await audit(client,plan.generation_id,actor,id,input.paused?"review.paused":"review.resumed",{paused:plan.paused,reason:input.reason},{paused:input.paused});
    return {id,paused:input.paused,revision:plan.revision+1};
  });
}
