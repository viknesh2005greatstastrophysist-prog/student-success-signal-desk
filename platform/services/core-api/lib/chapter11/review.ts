import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { withCoreTransaction } from "../db";
import { getCurrentGeneration, writeCommandLedger, findDuplicateCommand, assertCommandId } from "../command-ledger";
import { ConflictError, NotFoundError } from "../http";
import { requireRole } from "../security";
import { hashJson } from "../support-commands";
import { packetSchema, acceptanceChecks, type Evidence, type Risk, type PolicyGuard, type domainNames } from "./engine";

const editSchema = z.object({ expectedRevision: z.number().int().nonnegative(), artifactId: z.string().uuid(), packet: packetSchema, rationale: z.string().trim().min(12).max(600) }).strict();
export async function editDraft(actor: ActorContext, caseId: string, commandId: string, raw: unknown) {
  requireRole(actor, "faculty", "hod"); assertCommandId(commandId); z.string().uuid().parse(caseId);
  const input = editSchema.parse(raw);
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generation, commandId, actor.personId);
    if (duplicate) {
      if (duplicate.payload.requestHash !== hashJson({ caseId, input })) throw new ConflictError("IDEMPOTENCY_KEY_MISMATCH", "Command already used for another edit");
      return duplicate.payload;
    }
    const result = await client.query<{ revision: number; status: string; evidence: Evidence & { risk: Risk; policyGuard?:PolicyGuard }; domain: typeof domainNames[number]; run_id: string; artifact_id: string; artifact_version: number; student_id: string; department_id: string }>(
      `SELECT c.revision,c.status,e.evidence,p.body->>'domain' AS domain,r.id AS run_id,a.id AS artifact_id,a.artifact_version,c.student_id,p.department_id
       FROM support_cases c JOIN evidence_snapshots e ON e.support_case_id=c.id JOIN agent_runs r ON r.evidence_snapshot_id=e.id
       JOIN agent_artifacts a ON a.agent_run_id=r.id JOIN ch11_jobs j ON j.support_case_id=c.id JOIN ch11_plans p ON p.id=j.plan_id
       WHERE c.id=$1 AND c.generation_id=$2 AND (($4='hod' AND p.department_id=$5) OR ($4='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=c.student_id AND m.faculty_person_id=$3))) ORDER BY a.artifact_version DESC LIMIT 1 FOR UPDATE OF c`, [caseId, generation, actor.personId,actor.role,actor.departmentId]);
    if (!result.rowCount) throw new NotFoundError("Assigned Chapter 11 draft not found");
    const current = result.rows[0]!;
    if (current.status !== "awaiting_faculty" || current.revision !== input.expectedRevision || current.artifact_id !== input.artifactId) throw new ConflictError("STALE_ARTIFACT", "Reload the current draft before editing");
    const validation = acceptanceChecks(input.packet, current.evidence, current.evidence.risk, current.domain,current.evidence.policyGuard);
    if (!validation.valid) throw new ConflictError("EDIT_VALIDATION_FAILED", validation.failures.map(f => `${f.field}: ${f.code}`).join("; "));
    const id = randomUUID(), contentHash = hashJson(input.packet);
    await client.query("INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)", [id, generation, current.run_id, current.artifact_version + 1, contentHash, JSON.stringify(input.packet), JSON.stringify({ ...validation, valid: true, chapter11: true, mentorEdited: true, rationale: input.rationale })]);
    await client.query("UPDATE support_cases SET revision=revision+1 WHERE id=$1", [caseId]);
    const payload = { requestHash: hashJson({ caseId, input }), caseId, artifactId: id, contentHash, revision: current.revision + 1, studentId: current.student_id, departmentId: current.department_id, facultyPersonId: actor.personId };
    await writeCommandLedger(client, { generationId: generation, commandId, actorPersonId: actor.personId, aggregateType: "support_case", aggregateId: caseId, eventType: "support.draft_edited", action: "edit_chapter11_draft", topic: "support.draft.edited", payload, metadata: { rationale: input.rationale, previousArtifact: input.artifactId } });
    return payload;
  });
}

const outcomeSchema = z.object({ expectedRevision: z.number().int().nonnegative(), status: z.enum(["planned", "in_progress", "completed", "withdrawn"]), outcome: z.string().trim().min(12).max(1200) }).strict();
export async function recordOutcome(actor: ActorContext, planId: string, commandId: string, raw: unknown) {
  requireRole(actor, "faculty", "hod"); assertCommandId(commandId); z.string().uuid().parse(planId);
  const input = outcomeSchema.parse(raw);
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generation, commandId, actor.personId);
    if (duplicate) {
      if (duplicate.payload.requestHash !== hashJson({ planId, input })) throw new ConflictError("IDEMPOTENCY_KEY_MISMATCH", "Command already used for another outcome");
      return duplicate.payload;
    }
    const result = await client.query<{ id: string; student_id: string; department_id: string; plan: unknown }>(
      `SELECT p.id,p.student_id,s.department_id,p.plan FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id
       JOIN student_profiles s ON s.id=p.student_id WHERE p.id=$1 AND p.generation_id=$2 AND (($4='hod' AND s.department_id=$5) OR ($4='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=p.student_id AND m.faculty_person_id=$3))) FOR UPDATE OF p`, [planId, generation, actor.personId,actor.role,actor.departmentId]);
    if (!result.rowCount) throw new NotFoundError("Assigned approved plan not found");
    const prior = await client.query<{ revision: number }>("SELECT revision FROM ch11_interventions WHERE support_plan_id=$1 AND generation_id=$2 FOR UPDATE", [planId, generation]);
    const revision = prior.rows[0]?.revision ?? 0;
    if (revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "Reload the intervention before updating");
    await client.query(`INSERT INTO ch11_interventions(id,generation_id,support_plan_id,faculty_person_id,status,outcome,revision)
      VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT (generation_id,support_plan_id) DO UPDATE SET status=$5,outcome=$6,revision=ch11_interventions.revision+1,updated_at=now()`, [randomUUID(), generation, planId, actor.personId, input.status, input.outcome]);
    // Rollback withdraws the published release; restoring it reuses exactly its approved content.
    await client.query("UPDATE support_plans SET visible_to_student=$2 WHERE id=$1", [planId, input.status !== "withdrawn"]);
    const current = result.rows[0]!;
    const payload = { requestHash: hashJson({ planId, input }), planId, status: input.status, revision: revision + 1, outcome: input.outcome, studentId: current.student_id, departmentId: current.department_id, facultyPersonId: actor.personId };
    await writeCommandLedger(client, { generationId: generation, commandId, actorPersonId: actor.personId, aggregateType: "support_plan", aggregateId: planId, eventType: input.status === "withdrawn" ? "support.rolled_back" : "support.outcome_recorded", action: "record_support_outcome", topic: "support.plan.updated", payload, metadata: { approvedPlanHash: hashJson(current.plan), noAcademicSideEffects: true } });
    return payload;
  });
}
export async function reviewQueue(actor: ActorContext) {
  requireRole(actor, "faculty", "hod");
  return withCoreTransaction(async client => {
    const generation = await getCurrentGeneration(client);
    const plans = await client.query(`SELECT p.id,p.student_id,p.visible_to_student,p.plan,s.register_number,person.display_name,d.decision,d.rationale,d.decided_at,dp.display_name AS decided_by,
      COALESCE(i.status,'planned') AS status,COALESCE(i.revision,0) AS revision,COALESCE(i.outcome,'') AS outcome
      FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id JOIN people dp ON dp.id=d.faculty_person_id JOIN student_profiles s ON s.id=p.student_id
      JOIN people person ON person.id=s.person_id LEFT JOIN ch11_interventions i ON i.support_plan_id=p.id
      WHERE p.generation_id=$1 AND (($3='hod' AND s.department_id=$4) OR ($3='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=p.student_id AND m.faculty_person_id=$2))) ORDER BY p.created_at DESC`, [generation, actor.personId,actor.role,actor.departmentId]);
    const drafts = await client.query(`SELECT c.id,c.student_id,c.revision,c.status,a.id AS artifact_id,a.recommendation,a.content_hash,a.validation,r.mode,r.model_id,person.display_name
      FROM ch11_jobs j JOIN support_cases c ON c.id=j.support_case_id JOIN agent_runs r ON r.support_case_id=c.id
      JOIN agent_artifacts a ON a.agent_run_id=r.id JOIN student_profiles s ON s.id=c.student_id JOIN people person ON person.id=s.person_id
      WHERE j.generation_id=$1 AND (($3='hod' AND s.department_id=$4) OR ($3='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=s.id AND m.faculty_person_id=$2))) AND c.status='awaiting_faculty'
      AND a.artifact_version=(SELECT max(v.artifact_version) FROM agent_artifacts v WHERE v.agent_run_id=r.id)`, [generation, actor.personId,actor.role,actor.departmentId]);
    const log = await client.query(`SELECT e.id,e.aggregate_id AS plan_id,e.event_type,e.payload,e.occurred_at,actor.display_name AS actor_name,p.student_id,student.display_name AS student_name FROM domain_events e JOIN support_plans p ON p.id=e.aggregate_id AND p.generation_id=e.generation_id JOIN student_profiles sp ON sp.id=p.student_id JOIN people student ON student.id=sp.person_id JOIN people actor ON actor.id=e.actor_person_id WHERE e.generation_id=$1 AND e.aggregate_type='support_plan' AND e.aggregate_id=ANY($2::uuid[]) ORDER BY e.occurred_at DESC`,[generation,plans.rows.map(row=>row.id)]);
    const versions=await client.query(`SELECT v.support_plan_id,v.version,v.artifact_id,v.created_at,v.restored_from,a.content_hash,a.recommendation FROM ch11_publications v JOIN agent_artifacts a ON a.id=v.artifact_id WHERE v.generation_id=$1 AND v.support_plan_id=ANY($2::uuid[]) UNION ALL SELECT p.id,1,d.agent_artifact_id,p.created_at,NULL,a.content_hash,a.recommendation FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id JOIN agent_artifacts a ON a.id=d.agent_artifact_id WHERE p.generation_id=$1 AND p.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM ch11_publications v WHERE v.support_plan_id=p.id) ORDER BY version DESC`,[generation,plans.rows.map(row=>row.id)]);
    return { versions:versions.rows, plans: plans.rows, drafts: drafts.rows, interventionLog:log.rows };
  });
}

/** Restore is an assigned mentor's explicit publication action. It copies only
 * an earlier approved publication, never promotes an unapproved draft. */
export async function restoreVersion(actor:ActorContext,planId:string,commandId:string,raw:unknown){
 requireRole(actor,'faculty');assertCommandId(commandId);z.string().uuid().parse(planId);
 const input=z.object({version:z.number().int().positive(),expectedVersion:z.number().int().positive()}).strict().parse(raw);
 return withCoreTransaction(async client=>{
  const generation=await getCurrentGeneration(client);
  const duplicate=await findDuplicateCommand(client,generation,commandId,actor.personId);
  if(duplicate){if(duplicate.payload.requestHash!==hashJson({planId,input}))throw new ConflictError('IDEMPOTENCY_KEY_MISMATCH','Command already used');return duplicate.payload;}
  const plan=(await client.query(`SELECT p.*,s.department_id FROM support_plans p JOIN student_profiles s ON s.id=p.student_id WHERE p.id=$1 AND p.generation_id=$2 AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.generation_id=$2 AND m.student_id=p.student_id AND m.faculty_person_id=$3) FOR UPDATE OF p`,[planId,generation,actor.personId])).rows[0];
  if(!plan)throw new NotFoundError('Assigned approved plan not found');
  // New approvals are included lazily, without modifying the original decision.
  await client.query(`INSERT INTO ch11_publications(id,generation_id,support_plan_id,artifact_id,original_decision_id,version,actor_person_id) SELECT p.id,p.generation_id,p.id,d.agent_artifact_id,d.id,1,d.faculty_person_id FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE p.id=$1 AND d.decision='approved' ON CONFLICT DO NOTHING`,[planId]);
  const latest=(await client.query('SELECT max(version)::int AS version FROM ch11_publications WHERE support_plan_id=$1 AND generation_id=$2',[planId,generation])).rows[0].version;
  if(latest!==input.expectedVersion)throw new ConflictError('STALE_VERSION','Reload version history before restoring');
  const original=(await client.query(`SELECT v.*,a.agent_run_id,a.recommendation,a.validation,a.content_hash FROM ch11_publications v JOIN agent_artifacts a ON a.id=v.artifact_id JOIN faculty_decisions d ON d.id=v.original_decision_id WHERE v.support_plan_id=$1 AND v.generation_id=$2 AND v.version=$3 AND d.decision='approved'`,[planId,generation,input.version])).rows[0];
  if(!original)throw new NotFoundError('Approved publication version not found');
  const artifactId=randomUUID(),version=latest+1;
  const artifactVersion=(await client.query('SELECT max(artifact_version)::int+1 AS version FROM agent_artifacts WHERE agent_run_id=$1',[original.agent_run_id])).rows[0].version;
  await client.query('INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[artifactId,generation,original.agent_run_id,artifactVersion,original.content_hash,JSON.stringify(original.recommendation),JSON.stringify({...original.validation,restoredFrom:original.artifact_id,originalDecisionId:original.original_decision_id,restorationAuthorizedBy:actor.personId})]);
  await client.query('INSERT INTO ch11_publications(id,generation_id,support_plan_id,artifact_id,original_decision_id,version,actor_person_id,restored_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),generation,planId,artifactId,original.original_decision_id,version,actor.personId,original.id]);
  await client.query('UPDATE support_plans SET plan=$2::jsonb,visible_to_student=true WHERE id=$1',[planId,JSON.stringify(original.recommendation)]);
  await client.query(`INSERT INTO ch11_interventions(id,generation_id,support_plan_id,faculty_person_id,status,outcome,revision) VALUES($1,$2,$3,$4,'planned','Earlier approved publication restored',1) ON CONFLICT(generation_id,support_plan_id) DO UPDATE SET status='planned',outcome='Earlier approved publication restored',revision=ch11_interventions.revision+1,updated_at=now()`,[randomUUID(),generation,planId,actor.personId]);
  const payload={requestHash:hashJson({planId,input}),planId,version,restoredVersion:input.version,artifactId,studentId:plan.student_id,departmentId:plan.department_id,facultyPersonId:actor.personId};
  await writeCommandLedger(client,{generationId:generation,commandId,actorPersonId:actor.personId,aggregateType:'support_plan',aggregateId:planId,eventType:'support.version_restored',action:'restore_approved_version',topic:'support.plan.updated',payload,metadata:{originalDecisionId:original.original_decision_id,immutableCopy:true}});
  return payload;
 });
}
