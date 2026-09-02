import { createHash, randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";

import { assertCommandId, findDuplicateCommand, getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole } from "./security";

export const processAcademicEventInput = z.object({ eventId: z.string().uuid() });
export const supportDecisionInput = z.object({
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().nonnegative(),
  decision: z.enum(["approved", "rejected"]),
  rationale: z.string().trim().min(8).max(600),
});

type Recommendation = {
  summary: string;
  actions: Array<{ code: string; label: string; owner: "assigned_faculty" | "student"; dueInDays: number }>;
  citations: Array<{ evidencePath: string; statement: string }>;
  prohibited: string[];
};

const allowedActionCodes = new Set(["faculty-check-in", "student-study-plan"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function validateRecommendation(candidate: unknown) {
  const parsed = z.object({
    summary: z.string().trim().min(12).max(240),
    actions: z.array(z.object({
      code: z.string(),
      label: z.string().trim().min(8).max(160),
      owner: z.enum(["assigned_faculty", "student"]),
      dueInDays: z.number().int().min(1).max(14),
    })).min(1).max(3),
    citations: z.array(z.object({ evidencePath: z.string().startsWith("evidence."), statement: z.string().trim().min(8).max(180) })).min(1).max(4),
    prohibited: z.array(z.string()).max(4),
  }).safeParse(candidate);
  const reasons: string[] = [];
  if (!parsed.success) reasons.push("SCHEMA_INVALID");
  if (parsed.success && parsed.data.actions.some((action) => !allowedActionCodes.has(action.code))) reasons.push("UNSUPPORTED_ACTION");
  if (parsed.success && parsed.data.prohibited.length) reasons.push("PROHIBITED_AUTHORITY");
  return { valid: reasons.length === 0, reasons };
}

function deterministicRecommendation(evidence: Record<string, unknown>): Recommendation {
  const eventType = String(evidence.eventType ?? "academic signal").replaceAll(".", " ");
  return {
    summary: "Offer a bounded academic check-in and let the student agree the next study step.",
    actions: [
      { code: "faculty-check-in", label: "Schedule one 20-minute academic check-in", owner: "assigned_faculty", dueInDays: 7 },
      { code: "student-study-plan", label: "Agree one weekly study plan with the faculty member", owner: "student", dueInDays: 10 },
    ],
    citations: [
      { evidencePath: "evidence.sourceEvent", statement: `The recorded source is ${eventType}.` },
      { evidencePath: "evidence.academic", statement: "The recommendation uses only the frozen attendance and published-mark snapshot." },
    ],
    prohibited: [],
  };
}

const deterministicFallback: Recommendation = {
  summary: "Ask the assigned faculty member to review the frozen academic evidence manually.",
  actions: [{ code: "faculty-check-in", label: "Review the evidence with the student before deciding next steps", owner: "assigned_faculty", dueInDays: 7 }],
  citations: [{ evidencePath: "evidence.sourceEvent", statement: "A valid source academic event opened this bounded review." }],
  prohibited: [],
};

export function composeValidatedRecommendation(evidence: Record<string, unknown>, candidate?: unknown) {
  let recommendation = candidate ?? deterministicRecommendation(evidence);
  let validation = validateRecommendation(recommendation);
  let repairAttempted = false;
  let fallbackUsed = false;
  if (!validation.valid) {
    repairAttempted = true;
    recommendation = deterministicRecommendation(evidence);
    validation = validateRecommendation(recommendation);
  }
  if (!validation.valid) {
    fallbackUsed = true;
    recommendation = deterministicFallback;
    validation = validateRecommendation(recommendation);
  }
  if (!validation.valid) throw new ConflictError("UNSUPPORTED_OUTPUT", "The recommendation failed bounded validation");
  return { recommendation: recommendation as Recommendation, validation: { ...validation, repairAttempted, fallbackUsed, policyVersion: "AURA-SUPPORT-1" } };
}

type ProcessResult = {
  supportCase: { id: string; status: string; revision: number; riskBand: string; reason: string };
  run: { id: string; status: string; mode: string; inputHash: string };
  artifact: { id: string; contentHash: string; recommendation: Recommendation; validation: Record<string, unknown> };
  duplicate: boolean;
  receipt: Awaited<ReturnType<typeof writeCommandLedger>>;
};

export async function processAcademicEvent(
  actor: ActorContext,
  commandId: string,
  input: z.infer<typeof processAcademicEventInput>,
): Promise<ProcessResult> {
  assertCommandId(commandId);
  requireRole(actor, "governance");
  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return {
      supportCase: duplicate.payload.supportCase as ProcessResult["supportCase"],
      run: duplicate.payload.run as ProcessResult["run"],
      artifact: duplicate.payload.artifact as ProcessResult["artifact"],
      duplicate: true,
      receipt: duplicate.receipt,
    };
    const source = await client.query<{
      event_id: string; event_type: string; institution_revision: string; payload: Record<string, unknown>;
      outbox_id: string; delivered_at: Date | null; attempts: number;
    }>(
      `SELECT event.id AS event_id, event.event_type, event.institution_revision::text, event.payload,
              outbox.id AS outbox_id, outbox.delivered_at, outbox.attempts
       FROM domain_events event JOIN outbox_items outbox ON outbox.domain_event_id = event.id AND outbox.generation_id = event.generation_id
       WHERE event.generation_id = $1 AND event.id = $2 AND event.event_type IN ('attendance.submitted', 'marks.published')
       FOR UPDATE OF outbox`,
      [generationId, input.eventId],
    );
    if (!source.rowCount) throw new NotFoundError("Processable academic event not found");
    const event = source.rows[0]!;
    if (event.delivered_at) throw new ConflictError("EVENT_ALREADY_PROCESSED", "This academic event has already been processed");
    const studentIds = Array.isArray(event.payload.studentIds) ? event.payload.studentIds.filter((value): value is string => typeof value === "string") : [];
    const studentId = studentIds[0] ?? (typeof event.payload.studentId === "string" ? event.payload.studentId : undefined);
    const facultyPersonId = typeof event.payload.facultyPersonId === "string" ? event.payload.facultyPersonId : undefined;
    if (!studentId || !facultyPersonId) throw new ConflictError("DATA_BLOCKED", "The event is missing a student or assigned faculty reference");

    const subject = await client.query<{ student_id: string; register_number: string; display_name: string; department_id: string; faculty_name: string }>(
      `SELECT student.id AS student_id, student.register_number, person.display_name, student.department_id,
              faculty.display_name AS faculty_name
       FROM student_profiles student JOIN people person ON person.id = student.person_id
       JOIN people faculty ON faculty.generation_id = student.generation_id AND faculty.id = $3
       JOIN role_assignments role ON role.generation_id = faculty.generation_id AND role.person_id = faculty.id
         AND role.role = 'faculty' AND role.active AND role.department_id = student.department_id
       WHERE student.generation_id = $1 AND student.id = $2`,
      [generationId, studentId, facultyPersonId],
    );
    if (!subject.rowCount) throw new ConflictError("DATA_BLOCKED", "The referenced student or faculty assignment is no longer current");
    const student = subject.rows[0]!;
    const academic = await client.query(
      `SELECT 'attendance' AS kind, course.code, session.topic AS item, record.status AS value, session.revision
       FROM attendance_records record
       JOIN attendance_sessions session ON session.id = record.attendance_session_id
       JOIN course_offerings offering ON offering.id = session.course_offering_id
       JOIN courses course ON course.id = offering.course_id
       WHERE record.generation_id = $1 AND record.student_id = $2 AND session.status IN ('submitted', 'locked')
       UNION ALL
       SELECT 'mark' AS kind, course.code, assessment.title AS item, mark.score::text AS value, assessment.revision
       FROM marks mark
       JOIN assessments assessment ON assessment.id = mark.assessment_id
       JOIN course_offerings offering ON offering.id = assessment.course_offering_id
       JOIN courses course ON course.id = offering.course_id
       WHERE mark.generation_id = $1 AND mark.student_id = $2 AND assessment.published
       ORDER BY kind, code, item`,
      [generationId, studentId],
    );
    if (!academic.rowCount) throw new ConflictError("DATA_BLOCKED", "No submitted academic evidence is available for this event");
    const currentRevision = await client.query<{ revision: string }>("SELECT revision::text FROM institution_revisions WHERE singleton = true");
    const evidence = {
      sourceEvent: { id: event.event_id, type: event.event_type, institutionRevision: Number(event.institution_revision), payload: event.payload },
      capturedAtInstitutionRevision: Number(currentRevision.rows[0]!.revision),
      student: { id: student.student_id, registerNumber: student.register_number, displayName: student.display_name, departmentId: student.department_id },
      assignedFacultyPersonId: facultyPersonId,
      assignedFacultyName: student.faculty_name,
      academic: academic.rows,
    };
    const inputHash = hashJson(evidence);
    const caseId = randomUUID();
    const snapshotId = randomUUID();
    const runId = randomUUID();
    const artifactId = randomUUID();
    const reason = "A recent academic event warrants one bounded faculty-led check-in.";
    const riskBand = academic.rows.some((item) => item.kind === "attendance" && item.value === "absent") || academic.rows.some((item) => item.kind === "mark" && Number(item.value) < 60) ? "medium" : "low";
    await client.query(
      `INSERT INTO support_cases (id, generation_id, student_id, source, status, risk_band, reason)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6)`,
      [caseId, generationId, studentId, `domain_event:${event.event_id}`, riskBand, reason],
    );
    await client.query(
      `INSERT INTO evidence_snapshots (id, generation_id, support_case_id, institution_revision, input_hash, evidence)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [snapshotId, generationId, caseId, currentRevision.rows[0]!.revision, inputHash, JSON.stringify(evidence)],
    );
    await client.query(
      `INSERT INTO agent_runs (id, generation_id, support_case_id, evidence_snapshot_id, mode, status)
       VALUES ($1, $2, $3, $4, 'deterministic', 'running')`,
      [runId, generationId, caseId, snapshotId],
    );
    const composed = composeValidatedRecommendation(evidence);
    const contentHash = hashJson(composed.recommendation);
    await client.query(
      `INSERT INTO agent_artifacts (id, generation_id, agent_run_id, artifact_version, content_hash, recommendation, validation)
       VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6::jsonb)`,
      [artifactId, generationId, runId, contentHash, JSON.stringify(composed.recommendation), JSON.stringify(composed.validation)],
    );
    await client.query("UPDATE agent_runs SET status = 'validated', completed_at = now() WHERE id = $1", [runId]);
    const updatedCase = await client.query<{ revision: number }>(
      "UPDATE support_cases SET status = 'awaiting_faculty', revision = revision + 1 WHERE id = $1 RETURNING revision",
      [caseId],
    );
    await client.query("UPDATE outbox_items SET delivered_at = now(), attempts = attempts + 1 WHERE id = $1", [event.outbox_id]);
    const supportCase = { id: caseId, status: "awaiting_faculty", revision: updatedCase.rows[0]!.revision, riskBand, reason };
    const run = { id: runId, status: "validated", mode: "deterministic", inputHash };
    const artifact = { id: artifactId, contentHash, recommendation: composed.recommendation, validation: composed.validation };
    const payload = { studentId, departmentId: student.department_id, facultyPersonId, supportCase, run, artifact };
    const receipt = await writeCommandLedger(client, {
      generationId, commandId, actorPersonId: actor.personId,
      aggregateType: "support_case", aggregateId: caseId, eventType: "support.proposed",
      action: "process_academic_event", topic: "support.proposal.created", payload,
      metadata: { sourceEventId: event.event_id, inputHash, contentHash, mode: "deterministic" },
    });
    return { supportCase, run, artifact, duplicate: false, receipt };
  });
}

type DecisionResult = {
  supportCase: { id: string; status: string; revision: number };
  decision: { id: string; decision: "approved" | "rejected"; rationale: string };
  plan: { id: string; plan: Recommendation; visibleToStudent: true } | null;
  duplicate: boolean;
  receipt: Awaited<ReturnType<typeof writeCommandLedger>>;
};

export async function decideSupportCase(
  actor: ActorContext,
  caseId: string,
  commandId: string,
  input: z.infer<typeof supportDecisionInput>,
): Promise<DecisionResult> {
  assertCommandId(commandId);
  z.string().uuid().parse(caseId);
  requireRole(actor, "faculty");
  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return {
      supportCase: duplicate.payload.supportCase as DecisionResult["supportCase"],
      decision: duplicate.payload.decision as DecisionResult["decision"],
      plan: duplicate.payload.plan as DecisionResult["plan"], duplicate: true, receipt: duplicate.receipt,
    };
    const result = await client.query<{
      case_id: string; student_id: string; department_id: string; status: string; revision: number;
      artifact_id: string; content_hash: string; recommendation: Recommendation; assigned_faculty_person_id: string;
    }>(
      `SELECT support_case.id AS case_id, support_case.student_id, student.department_id, support_case.status, support_case.revision,
              artifact.id AS artifact_id, artifact.content_hash, artifact.recommendation,
              evidence.evidence->>'assignedFacultyPersonId' AS assigned_faculty_person_id
       FROM support_cases support_case
       JOIN student_profiles student ON student.id = support_case.student_id
       JOIN evidence_snapshots evidence ON evidence.support_case_id = support_case.id AND evidence.generation_id = support_case.generation_id
       JOIN agent_runs run ON run.evidence_snapshot_id = evidence.id AND run.generation_id = support_case.generation_id
       JOIN agent_artifacts artifact ON artifact.agent_run_id = run.id AND artifact.generation_id = support_case.generation_id
       WHERE support_case.generation_id = $1 AND support_case.id = $2
         AND evidence.evidence->>'assignedFacultyPersonId' = $3
       ORDER BY artifact.artifact_version DESC LIMIT 1
       FOR UPDATE OF support_case`,
      [generationId, caseId, actor.personId],
    );
    if (!result.rowCount) throw new NotFoundError("Assigned support case not found");
    const current = result.rows[0]!;
    if (current.status !== "awaiting_faculty") throw new ConflictError("CASE_NOT_AWAITING_DECISION", "This support case is no longer awaiting a decision");
    if (current.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "The support case changed after this page loaded");
    if (current.artifact_id !== input.artifactId || current.content_hash !== input.contentHash) {
      throw new ConflictError("STALE_ARTIFACT", "Approve or reject only the exact current artifact");
    }
    const decisionId = randomUUID();
    await client.query(
      `INSERT INTO faculty_decisions (id, generation_id, support_case_id, agent_artifact_id, faculty_person_id, decision, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [decisionId, generationId, caseId, input.artifactId, actor.personId, input.decision, input.rationale],
    );
    let plan: DecisionResult["plan"] = null;
    if (input.decision === "approved") {
      const planId = randomUUID();
      await client.query(
        `INSERT INTO support_plans (id, generation_id, support_case_id, faculty_decision_id, student_id, plan)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [planId, generationId, caseId, decisionId, current.student_id, JSON.stringify(current.recommendation)],
      );
      plan = { id: planId, plan: current.recommendation, visibleToStudent: true };
    }
    const nextStatus = input.decision === "approved" ? "approved" : "rejected";
    const updated = await client.query<{ revision: number }>(
      "UPDATE support_cases SET status = $2, revision = revision + 1 WHERE id = $1 RETURNING revision",
      [caseId, nextStatus],
    );
    const supportCase = { id: caseId, status: nextStatus, revision: updated.rows[0]!.revision };
    const decision = { id: decisionId, decision: input.decision, rationale: input.rationale };
    const payload = { studentId: current.student_id, departmentId: current.department_id, facultyPersonId: actor.personId, supportCase, decision, plan };
    const receipt = await writeCommandLedger(client, {
      generationId, commandId, actorPersonId: actor.personId,
      aggregateType: "support_case", aggregateId: caseId,
      eventType: input.decision === "approved" ? "support.approved" : "support.rejected",
      action: "decide_support_artifact", topic: input.decision === "approved" ? "support.plan.approved" : "support.proposal.rejected",
      payload, metadata: { artifactId: input.artifactId, contentHash: input.contentHash, expectedRevision: input.expectedRevision },
    });
    return { supportCase, decision, plan, duplicate: false, receipt };
  });
}

export async function replayAgentRun(actor: ActorContext, runId: string, commandId: string) {
  assertCommandId(commandId);
  z.string().uuid().parse(runId);
  requireRole(actor, "governance");
  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [commandId]);
    const existing = await client.query<{ id: string; requested_by_person_id: string; input_hash: string; output_hash: string; matched: boolean; created_at: Date }>(
      "SELECT id, requested_by_person_id, input_hash, output_hash, matched, created_at FROM replay_receipts WHERE generation_id = $1 AND command_id = $2",
      [generationId, commandId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0]!;
      if (row.requested_by_person_id !== actor.personId) throw new ConflictError("IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another actor");
      return { replay: { id: row.id, originalRunId: runId, inputHash: row.input_hash, outputHash: row.output_hash, matched: row.matched, createdAt: row.created_at.toISOString() }, duplicate: true };
    }
    const result = await client.query<{ input_hash: string; evidence: Record<string, unknown>; content_hash: string }>(
      `SELECT evidence.input_hash, evidence.evidence, artifact.content_hash
       FROM agent_runs run JOIN evidence_snapshots evidence ON evidence.id = run.evidence_snapshot_id
       JOIN agent_artifacts artifact ON artifact.agent_run_id = run.id
       WHERE run.generation_id = $1 AND run.id = $2 AND run.status IN ('validated', 'repaired')
       ORDER BY artifact.artifact_version DESC LIMIT 1`,
      [generationId, runId],
    );
    if (!result.rowCount) throw new NotFoundError("Replayable agent run not found");
    const original = result.rows[0]!;
    const replayed = composeValidatedRecommendation(original.evidence);
    const inputHash = hashJson(original.evidence);
    const outputHash = hashJson(replayed.recommendation);
    const replayId = randomUUID();
    const matched = inputHash === original.input_hash && outputHash === original.content_hash;
    const inserted = await client.query<{ created_at: Date }>(
      `INSERT INTO replay_receipts
       (id, generation_id, original_agent_run_id, replay_agent_run_id, requested_by_person_id, input_hash, output_hash, matched, command_id)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8) RETURNING created_at`,
      [replayId, generationId, runId, actor.personId, inputHash, outputHash, matched, commandId],
    );
    return { replay: { id: replayId, originalRunId: runId, inputHash, outputHash, matched, createdAt: inserted.rows[0]!.created_at.toISOString() }, duplicate: false };
  });
}

export async function loadGovernanceRun(actor: ActorContext, runId: string) {
  z.string().uuid().parse(runId);
  requireRole(actor, "governance");
  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const result = await client.query(
      `SELECT run.id, run.mode, run.status, run.started_at, run.completed_at,
              support_case.id AS support_case_id, support_case.status AS case_status, support_case.reason, support_case.risk_band,
              evidence.id AS evidence_snapshot_id, evidence.institution_revision, evidence.input_hash, evidence.evidence,
              artifact.id AS artifact_id, artifact.artifact_version, artifact.content_hash, artifact.recommendation, artifact.validation,
              COALESCE(jsonb_agg(jsonb_build_object('id', replay.id, 'inputHash', replay.input_hash, 'outputHash', replay.output_hash, 'matched', replay.matched, 'createdAt', replay.created_at)) FILTER (WHERE replay.id IS NOT NULL), '[]'::jsonb) AS replays
       FROM agent_runs run JOIN support_cases support_case ON support_case.id = run.support_case_id
       JOIN evidence_snapshots evidence ON evidence.id = run.evidence_snapshot_id
       JOIN agent_artifacts artifact ON artifact.agent_run_id = run.id
       LEFT JOIN replay_receipts replay ON replay.original_agent_run_id = run.id AND replay.generation_id = run.generation_id
       WHERE run.generation_id = $1 AND run.id = $2
       GROUP BY run.id, support_case.id, evidence.id, artifact.id`,
      [generationId, runId],
    );
    if (!result.rowCount) throw new NotFoundError("Agent run not found");
    return result.rows[0];
  });
}
