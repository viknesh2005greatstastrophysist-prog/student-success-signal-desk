import { createHash, randomUUID } from "node:crypto";

import { generateText, Output } from "ai";
import type { PoolClient } from "pg";
import { z } from "zod";

import { appendEvent, type DemoState, type LineageRecord, type StudentCase } from "./runtime";

export const PIPELINE_VERSION = "aura-agent-v2.0";
export const POLICY_VERSION_ID = "demo-policy-v2.0";
export const MODEL_ID = process.env.AURA_MODEL_ID ?? "openai/gpt-5.6-luna";
const MAX_MODEL_CALLS_PER_DAY = Math.max(1, Math.min(100, Number(process.env.AURA_MAX_MODEL_CALLS_PER_DAY ?? 20)));

const briefSchema = z.object({
  title: z.string().min(4).max(100),
  summary: z.string().min(20).max(700),
  evidenceClaims: z.array(z.object({
    text: z.string().min(4).max(260),
    evidenceRefs: z.array(z.string()).min(1).max(4),
  })).min(1).max(6),
  supportRanking: z.array(z.object({
    supportCode: z.string(),
    rationale: z.string().min(8).max(260),
  })).min(1).max(3),
  uncertainties: z.array(z.string().max(220)).max(4),
});

export type MentorBrief = z.infer<typeof briefSchema>;

type EligibleSupport = { code: string; label: string; rule: string };
type LedgerEvent = {
  eventType: string;
  actorUserId: string;
  actorRole: string;
  subjectId: string;
  runId?: string;
  caseId?: string;
  state: string;
  detail?: Record<string, unknown>;
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(json(value)).digest("hex");
}

function shortId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}

export async function appendLedger(client: PoolClient, state: DemoState, event: LedgerEvent): Promise<string> {
  const result = await client.query<{ event_id: string }>(
    `INSERT INTO aura_audit_events
      (event_type, actor_user_id, actor_role, subject_id, run_id, case_id, state, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING event_id::text`,
    [event.eventType, event.actorUserId, event.actorRole, event.subjectId, event.runId ?? null, event.caseId ?? null, event.state, json(event.detail ?? {})],
  );
  const eventId = result.rows[0].event_id;
  appendEvent(state, {
    type: event.eventType,
    actor: event.actorUserId,
    subject: event.subjectId,
    state: event.state,
    runId: event.runId,
    eventId,
  });
  return eventId;
}

async function persistArtifact(
  client: PoolClient,
  input: { runId: string; caseId: string; kind: string; version: number; payload: unknown; artifactId?: string },
): Promise<{ artifactId: string; sha256: string }> {
  const artifactId = input.artifactId ?? `ART-${shortId()}`;
  const sha256 = hashPayload(input.payload);
  await client.query(
    `INSERT INTO aura_artifacts (artifact_id, run_id, case_id, kind, version, payload, sha256)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [artifactId, input.runId, input.caseId, input.kind, input.version, json(input.payload), sha256],
  );
  return { artifactId, sha256 };
}

function sourceRef(item: StudentCase, source: StudentCase["sources"][number]): string {
  return `EVID-${item.studentRef}-${source.source.toUpperCase()}`;
}

function collectAuthorizedEvidence(item: StudentCase) {
  const allowedSources = new Set(["Academic", "LMS", "Internship", "Placement"]);
  return item.sources.map((source) => {
    if (!allowedSources.has(source.source)) throw new Error(`Unauthorized source ${source.source}`);
    return { evidenceRef: sourceRef(item, source), ...source };
  });
}

function qualityGate(evidence: ReturnType<typeof collectAuthorizedEvidence>) {
  const blockers = evidence
    .filter((item) => ["MISSING", "STALE"].includes(item.state) && ["Academic", "LMS"].includes(item.source))
    .map((item) => `${item.source}:${item.state}`);
  return { passed: blockers.length === 0, blockers };
}

function evaluatePolicy(item: StudentCase): EligibleSupport[] {
  const joined = item.signals.join(" ").toLowerCase();
  const eligible: EligibleSupport[] = [{ code: "SUP-MENTOR-CHECKIN", label: "Faculty mentor check-in", rule: "one or more validated signals" }];
  if (/attendance|cie|academic/.test(joined)) eligible.push({ code: "SUP-ACADEMIC-PLAN", label: "Short academic recovery plan", rule: "validated attendance or assessment signal" });
  if (/lms|learning/.test(joined)) eligible.push({ code: "SUP-LMS-REVIEW", label: "Learning activity review", rule: "validated LMS signal" });
  if (/placement|readiness/.test(joined)) eligible.push({ code: "SUP-READINESS-REVIEW", label: "Placement readiness review", rule: "validated readiness signal" });
  return eligible;
}

function fallbackBrief(item: StudentCase, evidence: ReturnType<typeof collectAuthorizedEvidence>, eligible: EligibleSupport[]): MentorBrief {
  const presentRefs = evidence.filter((entry) => entry.state === "PRESENT").map((entry) => entry.evidenceRef);
  return {
    title: `Mentor review brief for ${item.studentRef}`,
    summary: "Validated synthetic records contain items that require faculty review. This draft reports observed evidence only and does not predict a student outcome.",
    evidenceClaims: item.signals.slice(0, 5).map((signal, index) => ({ text: signal, evidenceRefs: [presentRefs[index % presentRefs.length]] })),
    supportRanking: eligible.slice(0, 3).map((support) => ({ supportCode: support.code, rationale: `${support.label} is eligible under ${support.rule}; the mentor decides whether it is appropriate.` })),
    uncertainties: evidence.filter((entry) => entry.state !== "PRESENT").map((entry) => `${entry.source} is ${entry.state.toLowerCase()}.`),
  };
}

async function composeWithModel(input: {
  item: StudentCase;
  evidence: ReturnType<typeof collectAuthorizedEvidence>;
  eligible: EligibleSupport[];
  violations?: string[];
  priorDraft?: MentorBrief;
}) {
  const prompt = {
    task: input.violations ? "Repair the mentor-facing brief once." : "Compose a mentor-facing brief.",
    rules: [
      "Use only the evidence records supplied below.",
      "Every evidence claim must cite at least one supplied evidenceRef.",
      "Rank only supportCode values in eligibleSupports.",
      "Do not predict failure, dropout, wellbeing, or any future outcome.",
      "Do not diagnose. Do not contact anyone. Do not approve support.",
      "Use restrained factual language and make uncertainty explicit.",
    ],
    syntheticCase: { studentRef: input.item.studentRef, signals: input.item.signals },
    evidence: input.evidence,
    eligibleSupports: input.eligible,
    priorDraft: input.priorDraft,
    validatorViolations: input.violations,
  };
  const started = Date.now();
  const result = await generateText({
    model: MODEL_ID,
    output: Output.object({ schema: briefSchema }),
    prompt: json(prompt),
    maxOutputTokens: 900,
    temperature: 0,
  });
  return {
    brief: result.output,
    latencyMs: Date.now() - started,
    usage: result.usage,
    finishReason: result.finishReason,
    providerMetadata: result.providerMetadata,
  };
}

export function critiqueBrief(brief: MentorBrief, allowedEvidenceRefs: Set<string>, eligibleSupportCodes: Set<string>): string[] {
  const violations: string[] = [];
  const prohibited = /\b(will fail|dropout risk|likely to fail|diagnos(?:e|is)|depress(?:ed|ion)|suicid(?:e|al)|mental illness|guaranteed)\b/i;
  const allText = [brief.title, brief.summary, ...brief.evidenceClaims.map((claim) => claim.text), ...brief.supportRanking.map((item) => item.rationale)].join(" ");
  if (prohibited.test(allText)) violations.push("PROHIBITED_OR_PREDICTIVE_LANGUAGE");
  for (const claim of brief.evidenceClaims) {
    if (claim.evidenceRefs.length === 0) violations.push("UNCITED_CLAIM");
    for (const ref of claim.evidenceRefs) if (!allowedEvidenceRefs.has(ref)) violations.push(`UNKNOWN_EVIDENCE_REF:${ref}`);
  }
  for (const support of brief.supportRanking) {
    if (!eligibleSupportCodes.has(support.supportCode)) violations.push(`INELIGIBLE_SUPPORT:${support.supportCode}`);
  }
  return [...new Set(violations)];
}

export async function executeAgentCycle(client: PoolClient, state: DemoState, actorUserId: string): Promise<{ runId: string; modelUsed: boolean; lineage: LineageRecord[] }> {
  const runId = `RUN-${shortId()}`;
  const collectionRunId = `COL-${shortId()}`;
  let modelAttempts = 0;
  let modelSuccesses = 0;
  const lineage: LineageRecord[] = [];
  const usageResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM aura_audit_events
     WHERE event_type IN ('BOUNDED_LLM_COMPOSED', 'COMPOSER_FALLBACK_USED')
       AND created_at >= NOW() - INTERVAL '24 hours'`,
  );
  const historicalModelAttempts = Number(usageResult.rows[0]?.count ?? 0);
  await client.query(
    `INSERT INTO aura_workflow_runs (run_id, actor_user_id, status, pipeline_version, policy_version_id, model_id)
     VALUES ($1, $2, 'RUNNING', $3, $4, $5)`,
    [runId, actorUserId, PIPELINE_VERSION, POLICY_VERSION_ID, MODEL_ID],
  );
  await appendLedger(client, state, { eventType: "COHORT_RUN_STARTED", actorUserId, actorRole: "OPERATIONS", subjectId: "CSE-AI-SYNTHETIC", runId, state: "RUNNING", detail: { pipelineVersion: PIPELINE_VERSION } });

  for (const item of state.cases) {
    const caseId = `CASE-${item.studentRef}`;
    const snapshotId = `SNAP-${shortId()}`;
    const replayId = `REPLAY-${shortId()}`;
    const evidence = collectAuthorizedEvidence(item);
    await persistArtifact(client, { runId, caseId, kind: "SOURCE_SNAPSHOT", version: 1, artifactId: snapshotId, payload: { collectionRunId, authorized: true, evidence } });
    await appendLedger(client, state, { eventType: "SOURCES_COLLECTED", actorUserId: "agent/source-collector", actorRole: "AGENT", subjectId: item.studentRef, runId, caseId, state: "COMPLETED", detail: { collectionRunId, snapshotId, sourceCount: evidence.length } });

    const quality = qualityGate(evidence);
    await persistArtifact(client, { runId, caseId, kind: "DATA_QUALITY", version: 1, payload: quality });
    if (!quality.passed) {
      await appendLedger(client, state, { eventType: "DATA_QUALITY_BLOCKED", actorUserId: "runtime/data-quality", actorRole: "RUNTIME", subjectId: item.studentRef, runId, caseId, state: "DATA_BLOCKED", detail: quality });
      const record: LineageRecord = { caseId, runId, collectionRunId, snapshotId, policyVersionId: POLICY_VERSION_ID, replayId, status: "DATA_BLOCKED" };
      lineage.push(record);
      await persistLineage(client, record);
      continue;
    }

    const eligible = evaluatePolicy(item);
    await persistArtifact(client, { runId, caseId, kind: "POLICY_DECISION", version: 1, payload: { policyVersionId: POLICY_VERSION_ID, eligible } });
    await appendLedger(client, state, { eventType: "POLICY_ELIGIBILITY_EVALUATED", actorUserId: "runtime/policy-engine", actorRole: "RUNTIME", subjectId: item.studentRef, runId, caseId, state: "COMPLETED", detail: { policyVersionId: POLICY_VERSION_ID, eligibleCodes: eligible.map((entry) => entry.code) } });

    const modelRunId = `MODEL-${shortId()}`;
    const promptArtifact = await persistArtifact(client, { runId, caseId, kind: "MODEL_INPUT", version: 1, payload: { modelRunId, modelId: MODEL_ID, evidence, eligible, constraints: "mentor-brief-v2" } });
    let composition;
    let modelError: string | undefined;
    try {
      if (historicalModelAttempts + modelAttempts >= MAX_MODEL_CALLS_PER_DAY) throw new Error("DAILY_MODEL_CALL_CAP_REACHED");
      modelAttempts += 1;
      composition = await composeWithModel({ item, evidence, eligible });
      modelSuccesses += 1;
    } catch (error) {
      modelError = error instanceof Error ? error.message : "Model generation failed";
      composition = { brief: fallbackBrief(item, evidence, eligible), latencyMs: 0, usage: null, finishReason: "fallback", providerMetadata: null };
    }
    let draft = composition.brief;
    const isRedTeamCase = item.studentRef === "SYN-0004";
    if (isRedTeamCase) draft = { ...draft, summary: `${draft.summary} The student will fail.` };
    const outputArtifact = await persistArtifact(client, { runId, caseId, kind: "MODEL_OUTPUT", version: 1, payload: { modelRunId, modelId: MODEL_ID, modelError, evaluationInjection: isRedTeamCase ? "synthetic-unsupported-claim" : null, ...composition, brief: draft, promptSha256: promptArtifact.sha256 } });
    await appendLedger(client, state, { eventType: modelError ? "COMPOSER_FALLBACK_USED" : "BOUNDED_LLM_COMPOSED", actorUserId: "agent/brief-composer", actorRole: "AGENT", subjectId: item.studentRef, runId, caseId, state: modelError ? "DEGRADED" : "COMPLETED", detail: { modelRunId, modelId: MODEL_ID, artifactId: outputArtifact.artifactId } });

    const allowedRefs = new Set(evidence.map((entry) => entry.evidenceRef));
    const eligibleCodes = new Set(eligible.map((entry) => entry.code));
    let violations = critiqueBrief(draft, allowedRefs, eligibleCodes);
    const criticArtifact = await persistArtifact(client, { runId, caseId, kind: "CRITIC_RESULT", version: 1, payload: { violations, passed: violations.length === 0 } });
    await appendLedger(client, state, { eventType: violations.length ? "CRITIC_REJECTED" : "CRITIC_VALIDATED", actorUserId: "runtime/critic", actorRole: "RUNTIME", subjectId: item.studentRef, runId, caseId, state: violations.length ? "REPAIR_REQUIRED" : "PASSED", detail: { violations, criticArtifactId: criticArtifact.artifactId } });

    let repairArtifactId: string | undefined;
    if (violations.length) {
      const initialViolations = violations;
      try {
        if (historicalModelAttempts + modelAttempts >= MAX_MODEL_CALLS_PER_DAY) throw new Error("DAILY_MODEL_CALL_CAP_REACHED");
        modelAttempts += 1;
        const repaired = await composeWithModel({ item, evidence, eligible, violations, priorDraft: draft });
        modelSuccesses += 1;
        draft = repaired.brief;
      } catch {
        draft = fallbackBrief(item, evidence, eligible);
      }
      violations = critiqueBrief(draft, allowedRefs, eligibleCodes);
      const repair = await persistArtifact(client, { runId, caseId, kind: "REPAIR_OUTPUT", version: 1, payload: { attempt: 1, initialViolations, remainingViolations: violations, brief: draft } });
      repairArtifactId = repair.artifactId;
      await appendLedger(client, state, { eventType: violations.length ? "REPAIR_CAP_REACHED" : "BOUNDED_REPAIR_VALIDATED", actorUserId: "agent/repair", actorRole: "AGENT", subjectId: item.studentRef, runId, caseId, state: violations.length ? "MENTOR_REVIEW_NO_RECOMMENDATION" : "PASSED", detail: { attempt: 1, repairArtifactId } });
    }

    const finalArtifact = await persistArtifact(client, { runId, caseId, kind: "MENTOR_BRIEF", version: 1, payload: { brief: draft, valid: violations.length === 0, mentorDecisionRequired: true } });
    if (violations.length === 0) item.recommendation = draft.supportRanking.map((entry) => `${entry.supportCode}: ${entry.rationale}`).join(" ");
    await appendLedger(client, state, { eventType: "MENTOR_INTERRUPT_OPENED", actorUserId: "runtime/orchestrator", actorRole: "RUNTIME", subjectId: item.studentRef, runId, caseId, state: "AWAITING_MENTOR", detail: { artifactVersionId: finalArtifact.artifactId, noInterventionCreated: true } });
    const record: LineageRecord = {
      caseId, runId, collectionRunId, snapshotId, policyVersionId: POLICY_VERSION_ID, modelRunId,
      artifactVersionId: finalArtifact.artifactId, criticArtifactId: criticArtifact.artifactId,
      repairArtifactId, replayId, status: violations.length ? "MENTOR_REVIEW_NO_RECOMMENDATION" : "AWAITING_MENTOR",
    };
    lineage.push(record);
    await persistLineage(client, record);
  }

  const modelUsed = modelAttempts > 0 && modelAttempts === modelSuccesses;
  await client.query("UPDATE aura_workflow_runs SET status = 'COMPLETED_WITH_BLOCKS', completed_at = NOW() WHERE run_id = $1", [runId]);
  await appendLedger(client, state, { eventType: "COHORT_RUN_COMPLETED", actorUserId: "runtime/orchestrator", actorRole: "RUNTIME", subjectId: "CSE-AI-SYNTHETIC", runId, state: "COMPLETED_WITH_BLOCKS", detail: { cases: lineage.length, blocked: lineage.filter((item) => item.status === "DATA_BLOCKED").length, modelUsed, modelAttempts, modelSuccesses } });
  return { runId, modelUsed, lineage };
}

async function persistLineage(client: PoolClient, record: LineageRecord): Promise<void> {
  await client.query(
    `INSERT INTO aura_case_lineage
      (case_id, run_id, collection_run_id, snapshot_id, policy_version_id, model_run_id, artifact_version_id, critic_artifact_id, repair_artifact_id, replay_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [record.caseId, record.runId, record.collectionRunId, record.snapshotId, record.policyVersionId, record.modelRunId ?? null, record.artifactVersionId ?? null, record.criticArtifactId ?? null, record.repairArtifactId ?? null, record.replayId, record.status],
  );
}

export async function replayLatestRun(client: PoolClient, state: DemoState, actorUserId: string) {
  const runResult = await client.query<{ run_id: string }>("SELECT run_id FROM aura_workflow_runs WHERE status LIKE 'COMPLETED%' ORDER BY started_at DESC LIMIT 1");
  const runId = runResult.rows[0]?.run_id;
  if (!runId) throw new Error("No completed workflow run is available for replay");
  const artifacts = await client.query<{ artifact_id: string; payload: unknown; sha256: string }>("SELECT artifact_id, payload, sha256 FROM aura_artifacts WHERE run_id = $1 ORDER BY created_at, artifact_id", [runId]);
  const events = await client.query<{ event_id: string }>("SELECT event_id::text FROM aura_audit_events WHERE run_id = $1 ORDER BY event_seq", [runId]);
  const invalid = artifacts.rows.filter((artifact) => hashPayload(artifact.payload) !== artifact.sha256);
  if (invalid.length) throw new Error(`Replay integrity failed for ${invalid.length} immutable artifact(s)`);
  const replayId = `REPLAY-${shortId()}`;
  const artifactsVerified = artifacts.rowCount ?? 0;
  const eventsReconstructed = events.rowCount ?? 0;
  await appendLedger(client, state, { eventType: "REPLAY_INTEGRITY_VERIFIED", actorUserId, actorRole: "OPERATIONS", subjectId: runId, runId, state: "VERIFIED", detail: { replayId, artifactsVerified, eventsReconstructed, modelRerun: false } });
  return { replayId, runId, artifactsVerified, eventsReconstructed, verifiedAt: new Date().toISOString() };
}
