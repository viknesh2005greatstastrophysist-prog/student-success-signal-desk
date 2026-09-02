import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { appendLedger, executeAgentCycle, MODEL_ID, replayLatestRun } from "./agent";
import { assignRole, ensureProfile, requireActorRole, resolveView, type StoredProfile } from "./authz";
import { pool } from "./db";
import {
  eventTime,
  initialState,
  scopeState,
  type DemoState,
  type InterventionStatus,
  type LineageRecord,
  type Role,
  type UserProfileSummary,
} from "./runtime";

export type ActionName = "run_cycle" | "replay" | "approve" | "reject" | "correct" | "advance" | "cancel" | "reset" | "assign_role";
export type ActionInput = {
  action: ActionName;
  requestedIdentityId?: string;
  subject?: string;
  rationale?: string;
  idempotencyKey?: string;
  targetUserId?: string;
  role?: Role;
  mentorId?: string;
  studentRef?: string;
};

type StoredRow = { state: DemoState; version: string | number };

async function ensureSeed(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO aura_state (id, state, version)
     VALUES (1, $1::jsonb, 1)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(initialState())],
  );
}

async function readStored(client: PoolClient, lock = false): Promise<{ state: DemoState; version: number }> {
  await ensureSeed(client);
  const result = await client.query<StoredRow>(`SELECT state, version FROM aura_state WHERE id = 1${lock ? " FOR UPDATE" : ""}`);
  const row = result.rows[0];
  if (!row) throw new Error("AURA state row is unavailable");
  return { state: row.state, version: Number(row.version) };
}

function requireSubject(subject: string | undefined): string {
  if (!subject || subject.length > 80) throw new Error("A valid subject is required");
  return subject;
}

function requireMentorCase(state: DemoState, profile: StoredProfile, subject: string) {
  requireActorRole(profile, ["MENTOR"]);
  const target = state.cases.find((item) => item.studentRef === subject);
  if (!target || target.mentorId !== profile.mentorId) throw new Error("The case is outside this mentor's assignment");
  return target;
}

async function latestRunIdForCase(client: PoolClient, studentRef: string): Promise<string | undefined> {
  const result = await client.query<{ run_id: string }>(
    "SELECT run_id FROM aura_case_lineage WHERE case_id = $1 ORDER BY run_id DESC LIMIT 1",
    [`CASE-${studentRef}`],
  );
  return result.rows[0]?.run_id;
}

async function applyMutation(client: PoolClient, state: DemoState, profile: StoredProfile, input: ActionInput): Promise<DemoState> {
  if (input.action === "reset") {
    requireActorRole(profile, ["OPERATIONS"]);
    const reset = initialState();
    await appendLedger(client, reset, { eventType: "SYNTHETIC_STATE_RESET", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: "CSE-AI-SYNTHETIC", state: "COMPLETED", detail: { historicalAuditRetained: true } });
    return reset;
  }
  if (input.action === "run_cycle") {
    requireActorRole(profile, ["OPERATIONS"]);
    const result = await executeAgentCycle(client, state, profile.clerkUserId);
    state.runs += 1;
    state.lastRun = `${eventTime()} IST`;
    state.latestRunId = result.runId;
    state.lineage = result.lineage;
    state.agentMode = result.modelUsed ? "governed-llm" : "governed-deterministic-fallback";
    state.modelId = MODEL_ID;
    return state;
  }
  if (input.action === "replay") {
    requireActorRole(profile, ["OPERATIONS"]);
    state.lastReplay = await replayLatestRun(client, state, profile.clerkUserId);
    return state;
  }
  if (input.action === "assign_role") {
    await assignRole(client, profile, input);
    await appendLedger(client, state, { eventType: "APPLICATION_ROLE_ASSIGNED", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: input.targetUserId ?? "unknown", state: "COMPLETED", detail: { role: input.role, mentorId: input.mentorId, studentRef: input.studentRef } });
    return state;
  }

  const subject = requireSubject(input.subject);
  if (["approve", "reject", "correct"].includes(input.action)) {
    const target = requireMentorCase(state, profile, subject);
    const relatedRunId = await latestRunIdForCase(client, subject);
    if (input.action === "approve") {
      if (target.status !== "AWAITING_MENTOR") throw new Error("Only a case awaiting mentor review can be approved");
      const decisionId = `DEC-${randomUUID().slice(0, 12).toUpperCase()}`;
      target.status = "CLOSED";
      target.closedReason = "Approved by assigned faculty mentor";
      let interventionId = state.interventions.find((item) => item.studentRef === subject)?.id;
      if (!interventionId) {
        interventionId = `INT-${randomUUID().slice(0, 12).toUpperCase()}`;
        await client.query(
          `INSERT INTO aura_mentor_decisions (decision_id, case_id, run_id, mentor_user_id, outcome, rationale)
           VALUES ($1, $2, $3, $4, 'APPROVED', $5)`,
          [decisionId, `CASE-${subject}`, relatedRunId ?? null, profile.clerkUserId, input.rationale?.slice(0, 500) || "Evidence reviewed"],
        );
        await client.query(
          `INSERT INTO aura_interventions (intervention_id, decision_id, case_id, mentor_user_id, support_code, status)
           VALUES ($1, $2, $3, $4, 'SUP-MENTOR-CHECKIN', 'PLANNED')`,
          [interventionId, decisionId, `CASE-${subject}`, profile.clerkUserId],
        );
        state.interventions.push({
          id: interventionId,
          studentRef: subject,
          ownerId: target.mentorId,
          support: "Faculty mentor check-in",
          rationale: input.rationale?.slice(0, 500) || "Approved after evidence, citations, and uncertainty review.",
          status: "PLANNED",
          due: "09 Sep 2026",
          outcome: "Not recorded",
        });
      }
      await appendLedger(client, state, { eventType: "MENTOR_APPROVED", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: subject, caseId: `CASE-${subject}`, runId: relatedRunId, state: "CLOSED", detail: { decisionId, interventionId, rationale: input.rationale?.slice(0, 500) || "Evidence reviewed" } });
      await appendLedger(client, state, { eventType: "INTERVENTION_CREATED_AFTER_APPROVAL", actorUserId: "runtime/intervention-ledger", actorRole: "RUNTIME", subjectId: subject, caseId: `CASE-${subject}`, runId: relatedRunId, state: "PLANNED", detail: { decisionId, interventionId, mentorGateSatisfied: true } });
    } else if (input.action === "reject") {
      if (target.status !== "AWAITING_MENTOR") throw new Error("Only a case awaiting mentor review can be rejected");
      const decisionId = `DEC-${randomUUID().slice(0, 12).toUpperCase()}`;
      target.status = "CLOSED";
      target.closedReason = "Rejected by assigned faculty mentor; no intervention created";
      await client.query(
        `INSERT INTO aura_mentor_decisions (decision_id, case_id, run_id, mentor_user_id, outcome, rationale)
         VALUES ($1, $2, $3, $4, 'REJECTED', $5)`,
        [decisionId, `CASE-${subject}`, relatedRunId ?? null, profile.clerkUserId, input.rationale?.slice(0, 500) || "Support rejected after evidence review"],
      );
      await appendLedger(client, state, { eventType: "MENTOR_REJECTED", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: subject, caseId: `CASE-${subject}`, runId: relatedRunId, state: "CLOSED", detail: { decisionId, interventionCreated: false } });
    } else {
      if (target.status !== "DATA_BLOCKED") throw new Error("Only a data-blocked synthetic case can receive corrected evidence");
      target.status = "AWAITING_MENTOR";
      target.priority = "MEDIUM";
      target.concern = 30;
      target.signals = ["Corrected synthetic evidence requires mentor review"];
      target.sources = target.sources.map((source) => ["MISSING", "STALE"].includes(source.state)
        ? { ...source, state: "PRESENT", detail: "Versioned synthetic correction submitted", observed: "02 Sep 2026" }
        : source);
      await appendLedger(client, state, { eventType: "SYNTHETIC_EVIDENCE_CORRECTION_SUBMITTED", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: subject, caseId: `CASE-${subject}`, runId: relatedRunId, state: "AWAITING_MENTOR", detail: { institutionalRecordChanged: false } });
    }
    return state;
  }

  requireActorRole(profile, ["MENTOR"]);
  const intervention = state.interventions.find((item) => item.id === subject);
  if (!intervention || intervention.ownerId !== profile.mentorId) throw new Error("The intervention is outside this mentor's assignment");
  if (["COMPLETED", "CANCELLED"].includes(intervention.status)) throw new Error("A terminal intervention cannot be changed");
  if (input.action === "cancel") {
    intervention.status = "CANCELLED";
    intervention.outcome = "No longer required";
  } else if (input.action === "advance") {
    const transition: Record<InterventionStatus, InterventionStatus> = {
      PLANNED: "SCHEDULED", SCHEDULED: "IN_PROGRESS", IN_PROGRESS: "COMPLETED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED",
    };
    intervention.status = transition[intervention.status];
    if (intervention.status === "COMPLETED") intervention.outcome = "Operational completion recorded; no causal claim";
  } else {
    throw new Error("Unknown action");
  }
  const followUpId = intervention.status === "COMPLETED" ? `FUP-${randomUUID().slice(0, 12).toUpperCase()}` : undefined;
  await client.query(
    `UPDATE aura_interventions SET status = $2, outcome = $3, updated_at = NOW()
     WHERE intervention_id = $1 AND mentor_user_id = $4`,
    [intervention.id, intervention.status, intervention.outcome, profile.clerkUserId],
  );
  if (followUpId) {
    await client.query(
      `INSERT INTO aura_followups (followup_id, intervention_id, recorded_by, operational_outcome)
       VALUES ($1, $2, $3, $4)`,
      [followUpId, intervention.id, profile.clerkUserId, intervention.outcome],
    );
  }
  await appendLedger(client, state, { eventType: "INTERVENTION_STATUS_UPDATED", actorUserId: profile.clerkUserId, actorRole: profile.role, subjectId: intervention.studentRef, caseId: `CASE-${intervention.studentRef}`, state: intervention.status, detail: { interventionId: intervention.id, followUpId, outcome: intervention.outcome, outboundContactPerformed: false } });
  return state;
}

async function listProfiles(client: PoolClient): Promise<UserProfileSummary[]> {
  const result = await client.query<{ clerk_user_id: string; role: Role; display_name: string; mentor_id: string | null; student_ref: string | null }>(
    "SELECT clerk_user_id, role, display_name, mentor_id, student_ref FROM aura_user_profiles WHERE active ORDER BY created_at",
  );
  return result.rows.map((row) => ({ userId: row.clerk_user_id, role: row.role, displayName: row.display_name, mentorId: row.mentor_id ?? undefined, studentRef: row.student_ref ?? undefined }));
}

async function loadLineage(client: PoolClient): Promise<LineageRecord[]> {
  const result = await client.query<{
    case_id: string; run_id: string; collection_run_id: string; snapshot_id: string; policy_version_id: string;
    model_run_id: string | null; artifact_version_id: string | null; critic_artifact_id: string | null; repair_artifact_id: string | null;
    replay_id: string; status: string;
  }>(`SELECT case_id, run_id, collection_run_id, snapshot_id, policy_version_id, model_run_id, artifact_version_id,
             critic_artifact_id, repair_artifact_id, replay_id, status
      FROM aura_case_lineage
      WHERE run_id = (SELECT run_id FROM aura_workflow_runs ORDER BY started_at DESC LIMIT 1)
      ORDER BY case_id`);
  return result.rows.map((row) => ({
    caseId: row.case_id, runId: row.run_id, collectionRunId: row.collection_run_id, snapshotId: row.snapshot_id,
    policyVersionId: row.policy_version_id, modelRunId: row.model_run_id ?? undefined, artifactVersionId: row.artifact_version_id ?? undefined,
    criticArtifactId: row.critic_artifact_id ?? undefined, repairArtifactId: row.repair_artifact_id ?? undefined,
    replayId: row.replay_id, status: row.status,
  }));
}

async function projectDashboard(client: PoolClient, state: DemoState, version: number, profile: StoredProfile, requestedIdentityId?: string | null): Promise<DemoState> {
  const { identity, available } = resolveView(profile, requestedIdentityId);
  const projected = scopeState(state, identity, version);
  const eventCount = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM aura_audit_events");
  projected.summary = { ...projected.summary!, eventCount: Number(eventCount.rows[0]?.count ?? projected.summary?.eventCount ?? 0) };
  projected.viewer = { role: profile.role, displayName: profile.displayName, mentorId: profile.mentorId, studentRef: profile.studentRef, canPreview: profile.canPreview };
  projected.activeIdentity = identity;
  projected.availableIdentities = available;
  projected.lineage = profile.role === "OPERATIONS" ? await loadLineage(client) : undefined;
  projected.userProfiles = profile.role === "OPERATIONS" ? await listProfiles(client) : undefined;
  projected.modelId = state.modelId ?? MODEL_ID;
  projected.agentMode = state.agentMode ?? "governed-deterministic-fallback";
  return projected;
}

export async function getDashboard(clerkUserId: string, requestedIdentityId?: string | null): Promise<DemoState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await ensureProfile(client, clerkUserId);
    const { state, version } = await readStored(client);
    const projected = await projectDashboard(client, state, version, profile, requestedIdentityId);
    await client.query("COMMIT");
    return projected;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function mutateDashboard(clerkUserId: string, input: ActionInput): Promise<DemoState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await ensureProfile(client, clerkUserId);
    const { state, version } = await readStored(client, true);
    if (input.idempotencyKey) {
      if (!/^[A-Za-z0-9:_-]{8,160}$/.test(input.idempotencyKey)) throw new Error("Invalid idempotency key");
      const inserted = await client.query(
        `INSERT INTO aura_idempotency_keys (key, actor_user_id, action)
         VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [input.idempotencyKey, clerkUserId, input.action],
      );
      if (!inserted.rowCount) {
        const projected = await projectDashboard(client, state, version, profile, input.requestedIdentityId);
        await client.query("COMMIT");
        return projected;
      }
    }
    const nextState = await applyMutation(client, structuredClone(state), profile, input);
    const nextVersion = version + 1;
    await client.query(
      "UPDATE aura_state SET state = $1::jsonb, version = $2, updated_at = NOW() WHERE id = 1",
      [JSON.stringify(nextState), nextVersion],
    );
    if (input.idempotencyKey) await client.query("UPDATE aura_idempotency_keys SET response_version = $2 WHERE key = $1", [input.idempotencyKey, nextVersion]);
    const projected = await projectDashboard(client, nextState, nextVersion, profile, input.requestedIdentityId);
    await client.query("COMMIT");
    return projected;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
