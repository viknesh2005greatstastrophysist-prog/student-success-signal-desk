import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { withCoreTransaction } from "../db";
import {
  getCurrentGeneration,
  writeCommandLedger,
  findDuplicateCommand,
  assertCommandId,
} from "../command-ledger";
import { ConflictError, NotFoundError } from "../http";
import { requireRole } from "../security";
import { awaitingCases } from "./awaiting";
import { actorScopeParams, actsOnStudentSql, requireReviewActor } from "./authority";
import {
  assertCaseNotFrozen,
  assertStudentNotFrozen,
  isFrozenCase,
  isFrozenRegisterNumber,
} from "./frozen";
import { caseEvidenceCapturedSql, loadGenerationClock, stampEvidence } from "../data-refresh/generation";
import { hashJson } from "../support-commands";
import { planMeetingFacts, planMeetingFields } from "../meetings";
import {
  anyPacketSchema,
  acceptanceChecks,
  type Policy,
  type Evidence,
  type Risk,
  type PolicyGuard,
  type domainNames,
} from "./engine";

const editSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    artifactId: z.string().uuid(),
    packet: anyPacketSchema,
    rationale: z.string().trim().min(12).max(600),
  })
  .strict();
export async function editDraft(
  actor: ActorContext,
  caseId: string,
  commandId: string,
  raw: unknown,
) {
  // The assigned mentor, or the department head for any student in the
  // department (owner decision, 17 Oct; authority.ts).
  requireReviewActor(actor);
  assertCommandId(commandId);
  z.string().uuid().parse(caseId);
  const input = editSchema.parse(raw);
  assertCaseNotFrozen(caseId);
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(
      client,
      generation,
      commandId,
      actor.personId,
    );
    if (duplicate) {
      if (duplicate.payload.requestHash !== hashJson({ caseId, input }))
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "Command already used for another edit",
        );
      return duplicate.payload;
    }
    const result = await client.query<{
      revision: number;
      status: string;
      evidence: Evidence & {
        risk: Risk;
        policyGuard?: PolicyGuard;
        policy?: Policy;
      };
      domain: (typeof domainNames)[number];
      run_id: string;
      run_mode: string;
      artifact_id: string;
      artifact_version: number;
      student_id: string;
      department_id: string;
      policy_guard: PolicyGuard;
    }>(
      `SELECT c.revision,c.status,e.evidence,p.body->>'domain' AS domain,r.id AS run_id,r.mode AS run_mode,a.id AS artifact_id,a.artifact_version,c.student_id,p.department_id,jsonb_build_object('version',COALESCE(pa.policy_version,''),'facultyApproved',COALESCE(pa.approved_role='faculty',false)) AS policy_guard
       FROM support_cases c JOIN evidence_snapshots e ON e.support_case_id=c.id JOIN agent_runs r ON r.evidence_snapshot_id=e.id
       JOIN agent_artifacts a ON a.agent_run_id=r.id JOIN ch11_jobs j ON j.support_case_id=c.id JOIN ch11_plans p ON p.id=j.plan_id LEFT JOIN ch11_policy_attestations pa ON pa.policy_id=(p.body->>'policyId')::uuid AND pa.generation_id=c.generation_id
       WHERE c.id=$1 AND c.generation_id=$2 AND ${actsOnStudentSql("c.student_id", "$4", "$3", "$5")} ORDER BY a.artifact_version DESC LIMIT 1 FOR UPDATE OF c`,
      [caseId, generation, actor.personId, actor.role, actor.departmentId ?? null],
    );
    if (!result.rowCount)
      throw new NotFoundError("Assigned Chapter 11 draft not found");
    const current = result.rows[0]!;
    await assertStudentNotFrozen(client, current.student_id);
    if (current.run_mode !== "model")
      throw new ConflictError(
        "LEGACY_DRAFT_READ_ONLY",
        "This draft was written by the retired rule-based path. It stays viewable, but only AI-written drafts can be edited or decided.",
      );
    if (
      current.status !== "awaiting_faculty" ||
      current.revision !== input.expectedRevision ||
      current.artifact_id !== input.artifactId
    )
      throw new ConflictError(
        "STALE_ARTIFACT",
        "Reload the current draft before editing",
      );
    // Mentor edits are revalidated under the rules of their packet version:
    // v1 exact-string checks, v2 claim-level checks against the frozen snapshot.
    const validation = acceptanceChecks(
      input.packet,
      current.evidence,
      current.evidence.risk,
      current.domain,
      current.policy_guard,
      { policy: current.evidence.policy },
    );
    if (!validation.valid)
      throw new ConflictError(
        "EDIT_VALIDATION_FAILED",
        validation.failures.map((f) => `${f.field}: ${f.code}`).join("; "),
      );
    const id = randomUUID(),
      contentHash = hashJson(input.packet);
    await client.query(
      "INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [
        id,
        generation,
        current.run_id,
        current.artifact_version + 1,
        contentHash,
        JSON.stringify(input.packet),
        JSON.stringify({
          ...validation,
          valid: true,
          chapter11: true,
          policyVersion: current.evidence.risk.policyVersion,
          editorRole: actor.role,
          mentorEdited: actor.role === "faculty",
          rationale: input.rationale,
        }),
      ],
    );
    await client.query(
      "UPDATE support_cases SET revision=revision+1 WHERE id=$1",
      [caseId],
    );
    const payload = {
      requestHash: hashJson({ caseId, input }),
      caseId,
      artifactId: id,
      contentHash,
      revision: current.revision + 1,
      studentId: current.student_id,
      departmentId: current.department_id,
      facultyPersonId: actor.personId,
    };
    await writeCommandLedger(client, {
      generationId: generation,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "support_case",
      aggregateId: caseId,
      eventType: "support.draft_edited",
      action: "edit_chapter11_draft",
      topic: "support.draft.edited",
      payload,
      metadata: {
        editorRole: actor.role,
        rationale: input.rationale,
        previousArtifact: input.artifactId,
      },
    });
    return payload;
  });
}

const outcomeSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(["planned", "in_progress", "completed", "withdrawn"]),
    outcome: z.string().trim().min(12).max(1200),
  })
  .strict();
export async function recordOutcome(
  actor: ActorContext,
  planId: string,
  commandId: string,
  raw: unknown,
) {
  // The assigned mentor, or the department head for any student in the
  // department, records outcomes or withdraws a plan (authority.ts).
  requireReviewActor(actor);
  assertCommandId(commandId);
  z.string().uuid().parse(planId);
  const input = outcomeSchema.parse(raw);
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(
      client,
      generation,
      commandId,
      actor.personId,
    );
    if (duplicate) {
      if (duplicate.payload.requestHash !== hashJson({ planId, input }))
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "Command already used for another outcome",
        );
      return duplicate.payload;
    }
    const result = await client.query<{
      id: string;
      student_id: string;
      department_id: string;
      plan: unknown;
    }>(
      `SELECT p.id,p.student_id,s.department_id,p.plan FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id
       JOIN student_profiles s ON s.id=p.student_id WHERE p.id=$1 AND p.generation_id=$2 AND ${actsOnStudentSql("p.student_id", "$3", "$4", "$5")} FOR UPDATE OF p`,
      [planId, generation, ...actorScopeParams(actor)],
    );
    if (!result.rowCount)
      throw new NotFoundError("Assigned approved plan not found");
    await assertStudentNotFrozen(client, result.rows[0]!.student_id);
    const prior = await client.query<{ revision: number }>(
      "SELECT revision FROM ch11_interventions WHERE support_plan_id=$1 AND generation_id=$2 FOR UPDATE",
      [planId, generation],
    );
    const revision = prior.rows[0]?.revision ?? 0;
    if (revision !== input.expectedRevision)
      throw new ConflictError(
        "STALE_VERSION",
        "Reload the intervention before updating",
      );
    await client.query(
      `INSERT INTO ch11_interventions(id,generation_id,support_plan_id,faculty_person_id,status,outcome,revision)
      VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT (generation_id,support_plan_id) DO UPDATE SET status=$5,outcome=$6,revision=ch11_interventions.revision+1,updated_at=now()`,
      [
        randomUUID(),
        generation,
        planId,
        actor.personId,
        input.status,
        input.outcome,
      ],
    );
    // Rollback withdraws the published release. Any other status leaves visibility as
    // it is: a withdrawn plan is shown again only by restoreVersion, which republishes
    // exactly an approved version.
    if (input.status === "withdrawn")
      await client.query(
        "UPDATE support_plans SET visible_to_student=false WHERE id=$1",
        [planId],
      );
    const current = result.rows[0]!;
    const payload = {
      requestHash: hashJson({ planId, input }),
      planId,
      status: input.status,
      revision: revision + 1,
      outcome: input.outcome,
      studentId: current.student_id,
      departmentId: current.department_id,
      facultyPersonId: actor.personId,
    };
    await writeCommandLedger(client, {
      generationId: generation,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "support_plan",
      aggregateId: planId,
      eventType:
        input.status === "withdrawn"
          ? "support.rolled_back"
          : "support.outcome_recorded",
      action: "record_support_outcome",
      topic: "support.plan.updated",
      payload,
      metadata: {
        approvedPlanHash: hashJson(current.plan),
        noAcademicSideEffects: true,
      },
    });
    return payload;
  });
}
export async function reviewQueue(actor: ActorContext) {
  requireRole(actor, "faculty", "hod");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    // Plans and drafts carry the data generation their evidence was captured on, so
    // staff can see which ones are based on earlier figures.
    const clock = await loadGenerationClock(client);
    const plans = await client.query(
      `SELECT p.id,p.student_id,p.visible_to_student,p.plan,s.register_number,person.display_name,d.decision,d.rationale,d.decided_at,dp.display_name AS decided_by,
      COALESCE(i.status,'planned') AS status,COALESCE(i.revision,0) AS revision,COALESCE(i.outcome,'') AS outcome,${caseEvidenceCapturedSql("p.support_case_id")} AS evidence_captured_at
      FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id JOIN people dp ON dp.id=d.faculty_person_id JOIN student_profiles s ON s.id=p.student_id
      JOIN people person ON person.id=s.person_id LEFT JOIN ch11_interventions i ON i.support_plan_id=p.id
      WHERE p.generation_id=$1 AND (($3='hod' AND s.department_id=$4) OR ($3='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=p.student_id AND m.faculty_person_id=$2))) ORDER BY p.created_at DESC`,
      [generation, actor.personId, actor.role, actor.departmentId],
    );
    // One definition of "awaiting decision" (awaiting.ts): the latest active AI
    // draft per student; earlier open drafts ride along as history. Each draft says
    // whether a parent holds the support grant, so the mentor is told who will see it.
    const groups = await awaitingCases(client, generation, actor);
    const DRAFT_SELECT = `SELECT c.id,c.student_id,c.revision,c.status,a.id AS artifact_id,a.artifact_version,a.recommendation,a.content_hash,a.validation,a.created_at AS drafted_at,r.mode,r.model_id,person.display_name,s.register_number,
      jsonb_build_object('academic',es.evidence->'academic'->'values','lms',es.evidence->'lms'->'values','internship',es.evidence->'internship'->'values','placement',es.evidence->'placement'->'values') AS evidence_values,
      es.evidence->'risk'->'signals' AS signals,es.evidence->'policy' AS policy,es.captured_at AS evidence_captured_at,
      EXISTS(SELECT 1 FROM parent_links l JOIN parent_field_grants g ON g.parent_link_id=l.id WHERE l.generation_id=c.generation_id AND l.student_id=c.student_id AND l.active AND g.field_group='support' AND g.granted) AS parent_support_access
      FROM support_cases c JOIN agent_runs r ON r.support_case_id=c.id JOIN evidence_snapshots es ON es.id=r.evidence_snapshot_id
      JOIN agent_artifacts a ON a.agent_run_id=r.id JOIN student_profiles s ON s.id=c.student_id JOIN people person ON person.id=s.person_id`;
    const currentIds = groups.map((group) => group.current.artifact_id);
    const activeRows = currentIds.length
      ? (await client.query(`${DRAFT_SELECT} WHERE a.id=ANY($1::uuid[])`, [currentIds])).rows
      : [];
    const byArtifact = new Map(activeRows.map((row) => [row.artifact_id, row]));
    const active = groups.flatMap((group) => {
      const row = byArtifact.get(group.current.artifact_id);
      if (!row) return [];
      return [
        {
          ...row,
          earlier_count: group.earlier.length,
          earlier_drafts: group.earlier.map((e) => ({
            case_id: e.case_id,
            artifact_id: e.artifact_id,
            artifact_version: e.artifact_version,
            opened_at: e.opened_at,
            drafted_at: e.drafted_at,
          })),
        },
      ];
    });
    // Drafts written by the retired rule-based path never count as awaiting;
    // they stay on record, read-only, so nothing disappears (and none is decided).
    const legacy = (
      await client.query(
        `${DRAFT_SELECT} WHERE c.generation_id=$1 AND c.status='awaiting_faculty' AND r.mode<>'model'
        AND EXISTS(SELECT 1 FROM ch11_jobs j WHERE j.support_case_id=c.id AND j.generation_id=$1)
        AND (($3='hod' AND s.department_id=$4) OR ($3='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=s.id AND m.faculty_person_id=$2)))
        AND a.artifact_version=(SELECT max(v.artifact_version) FROM agent_artifacts v WHERE v.agent_run_id=r.id)
        ORDER BY a.created_at DESC`,
        [generation, actor.personId, actor.role, actor.departmentId],
      )
    ).rows;
    const log = await client.query(
      `SELECT e.id,e.aggregate_id AS plan_id,e.event_type,e.payload,e.occurred_at,actor.display_name AS actor_name,p.student_id,student.display_name AS student_name FROM domain_events e JOIN support_plans p ON p.id=e.aggregate_id AND p.generation_id=e.generation_id JOIN student_profiles sp ON sp.id=p.student_id JOIN people student ON student.id=sp.person_id JOIN people actor ON actor.id=e.actor_person_id WHERE e.generation_id=$1 AND e.aggregate_type='support_plan' AND e.aggregate_id=ANY($2::uuid[]) ORDER BY e.occurred_at DESC`,
      [generation, plans.rows.map((row) => row.id)],
    );
    // Review R-10: every decision a mentor made counts, approvals and declines alike
    // (support_plans exist only for approvals). Counts and times only, no content.
    const mentorDecisions =
      actor.role === "hod"
        ? (
            await client.query(
              `SELECT d.faculty_person_id,dp.display_name AS mentor_name,count(*)::int AS decisions,
              count(*) FILTER (WHERE d.decision='approved')::int AS approved,count(*) FILTER (WHERE d.decision='rejected')::int AS declined,
              max(d.decided_at) AS last_decided_at
              FROM faculty_decisions d JOIN support_cases c ON c.id=d.support_case_id JOIN student_profiles s ON s.id=c.student_id JOIN people dp ON dp.id=d.faculty_person_id
              WHERE d.generation_id=$1 AND s.department_id=$2 GROUP BY d.faculty_person_id,dp.display_name ORDER BY dp.display_name`,
              [generation, actor.departmentId],
            )
          ).rows
        : [];
    const versions = await client.query(
      `SELECT v.support_plan_id,v.version,v.artifact_id,v.created_at,v.restored_from,a.content_hash,a.recommendation FROM ch11_publications v JOIN agent_artifacts a ON a.id=v.artifact_id WHERE v.generation_id=$1 AND v.support_plan_id=ANY($2::uuid[]) UNION ALL SELECT p.id,1,d.agent_artifact_id,p.created_at,NULL,a.content_hash,a.recommendation FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id JOIN agent_artifacts a ON a.id=d.agent_artifact_id WHERE p.generation_id=$1 AND p.id=ANY($2::uuid[]) AND NOT EXISTS(SELECT 1 FROM ch11_publications v WHERE v.support_plan_id=p.id) ORDER BY version DESC`,
      [generation, plans.rows.map((row) => row.id)],
    );
    // Drafts with their packet, validation, signals and evidence go to the
    // student's mentor and to the department head for the whole department
    // (owner decision, 17 Oct; service.ts seesReviewContent). Any other role would
    // get who is waiting on a mentor and the draft's state, never its content.
    // Frozen records (frozen.ts) stay visible; the flag lets the screens show them
    // read-only without knowing which ids are frozen.
    const frozen = <T extends Record<string, unknown>>(row: T) => ({
      ...row,
      frozen:
        isFrozenRegisterNumber(row.register_number) ||
        isFrozenCase(row.id) ||
        (Array.isArray(row.earlier_drafts) &&
          row.earlier_drafts.some((e: { case_id?: unknown }) => isFrozenCase(e.case_id))),
    });
    const shape = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      actor.role === "faculty" || actor.role === "hod"
        ? rows
        : rows.map(
            (row) =>
              ({
                id: row.id,
                student_id: row.student_id,
                display_name: row.display_name,
                register_number: row.register_number,
                revision: row.revision,
                status: row.status,
                mode: row.mode,
                model_id: row.model_id,
                drafted_at: row.drafted_at,
                earlier_count: row.earlier_count,
                earlier_drafts: row.earlier_drafts,
                evidence_current: row.evidence_current,
                evidence_generation: row.evidence_generation,
                frozen: row.frozen,
              }) as unknown as T,
          );
    // The conversation about each plan's AI report (meetings.ts): its day and
    // reasons, or where it stands (due, meet by now, past the deadline).
    const meetings = await planMeetingFacts(client, generation, plans.rows.map((row) => row.id));
    const withMeeting = <T extends { id: string }>(row: T) => ({ ...row, ...planMeetingFields(meetings.get(row.id)) });
    return {
      versions: versions.rows,
      plans: plans.rows.map((row) => withMeeting(frozen(stampEvidence(clock, row)))),
      drafts: shape(active.map((row) => frozen(stampEvidence(clock, row)))),
      awaitingCount: groups.length,
      legacyDrafts: shape(legacy.map((row) => frozen(stampEvidence(clock, row)))),
      interventionLog: log.rows,
      mentorDecisions,
      dataGeneration: { current: clock.current, since: clock.since },
    };
  });
}

/** Restore is an explicit publication action of the assigned mentor or the
 * department head (authority.ts). It copies only an earlier approved
 * publication, never promotes an unapproved draft. */
export async function restoreVersion(
  actor: ActorContext,
  planId: string,
  commandId: string,
  raw: unknown,
) {
  requireReviewActor(actor);
  assertCommandId(commandId);
  z.string().uuid().parse(planId);
  const input = z
    .object({
      version: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
    })
    .strict()
    .parse(raw);
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(
      client,
      generation,
      commandId,
      actor.personId,
    );
    if (duplicate) {
      if (duplicate.payload.requestHash !== hashJson({ planId, input }))
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "Command already used",
        );
      return duplicate.payload;
    }
    const plan = (
      await client.query(
        `SELECT p.*,s.department_id FROM support_plans p JOIN student_profiles s ON s.id=p.student_id WHERE p.id=$1 AND p.generation_id=$2 AND ${actsOnStudentSql("p.student_id", "$3", "$4", "$5")} FOR UPDATE OF p`,
        [planId, generation, ...actorScopeParams(actor)],
      )
    ).rows[0];
    if (!plan) throw new NotFoundError("Assigned approved plan not found");
    await assertStudentNotFrozen(client, plan.student_id);
    // New approvals are included lazily, without modifying the original decision.
    await client.query(
      `INSERT INTO ch11_publications(id,generation_id,support_plan_id,artifact_id,original_decision_id,version,actor_person_id) SELECT p.id,p.generation_id,p.id,d.agent_artifact_id,d.id,1,d.faculty_person_id FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE p.id=$1 AND d.decision='approved' ON CONFLICT DO NOTHING`,
      [planId],
    );
    const latest = (
      await client.query(
        "SELECT max(version)::int AS version FROM ch11_publications WHERE support_plan_id=$1 AND generation_id=$2",
        [planId, generation],
      )
    ).rows[0].version;
    if (latest !== input.expectedVersion)
      throw new ConflictError(
        "STALE_VERSION",
        "Reload version history before restoring",
      );
    const original = (
      await client.query(
        `SELECT v.*,a.agent_run_id,a.recommendation,a.validation,a.content_hash FROM ch11_publications v JOIN agent_artifacts a ON a.id=v.artifact_id JOIN faculty_decisions d ON d.id=v.original_decision_id WHERE v.support_plan_id=$1 AND v.generation_id=$2 AND v.version=$3 AND d.decision='approved'`,
        [planId, generation, input.version],
      )
    ).rows[0];
    if (!original)
      throw new NotFoundError("Approved publication version not found");
    const artifactId = randomUUID(),
      version = latest + 1;
    const artifactVersion = (
      await client.query(
        "SELECT max(artifact_version)::int+1 AS version FROM agent_artifacts WHERE agent_run_id=$1",
        [original.agent_run_id],
      )
    ).rows[0].version;
    await client.query(
      "INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [
        artifactId,
        generation,
        original.agent_run_id,
        artifactVersion,
        original.content_hash,
        JSON.stringify(original.recommendation),
        JSON.stringify({
          ...original.validation,
          restoredFrom: original.artifact_id,
          originalDecisionId: original.original_decision_id,
          restorationAuthorizedBy: actor.personId,
        }),
      ],
    );
    await client.query(
      "INSERT INTO ch11_publications(id,generation_id,support_plan_id,artifact_id,original_decision_id,version,actor_person_id,restored_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        generation,
        planId,
        artifactId,
        original.original_decision_id,
        version,
        actor.personId,
        original.id,
      ],
    );
    await client.query(
      "UPDATE support_plans SET plan=$2::jsonb,visible_to_student=true WHERE id=$1",
      [planId, JSON.stringify(original.recommendation)],
    );
    await client.query(
      `INSERT INTO ch11_interventions(id,generation_id,support_plan_id,faculty_person_id,status,outcome,revision) VALUES($1,$2,$3,$4,'planned','Earlier approved publication restored',1) ON CONFLICT(generation_id,support_plan_id) DO UPDATE SET status='planned',outcome='Earlier approved publication restored',revision=ch11_interventions.revision+1,updated_at=now()`,
      [randomUUID(), generation, planId, actor.personId],
    );
    const payload = {
      requestHash: hashJson({ planId, input }),
      planId,
      version,
      restoredVersion: input.version,
      artifactId,
      studentId: plan.student_id,
      departmentId: plan.department_id,
      facultyPersonId: actor.personId,
    };
    await writeCommandLedger(client, {
      generationId: generation,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "support_plan",
      aggregateId: planId,
      eventType: "support.version_restored",
      action: "restore_approved_version",
      topic: "support.plan.updated",
      payload,
      metadata: {
        originalDecisionId: original.original_decision_id,
        immutableCopy: true,
      },
    });
    return payload;
  });
}
