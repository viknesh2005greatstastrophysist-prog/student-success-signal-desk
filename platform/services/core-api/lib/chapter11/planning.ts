import { createHash, randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { withCoreTransaction } from "../db";
import { getCurrentGeneration } from "../command-ledger";
import { ConflictError } from "../http";
import { requireRole } from "../security";
import {
  planInputSchema,
  policySchema,
  withoutAgentFields,
  type AgentRunSummary,
  type PlanInput,
} from "./engine";
import {
  loadGuardRoster,
  loadPlan,
  recordPlannerAudit,
  savePlannedPlan,
} from "./service";
import {
  buildPlannerAliases,
  runPlanner,
  scopeConflictQuestion,
  type PlannerCurrent,
  type PlannerPins,
  type PlanningScope,
} from "./planner";
import { modelEndpoints, type ChainOptions, type Endpoint } from "./provider";
import { AiUnavailableError, QuotaWaitError, quotaWaitSeconds, unavailableReasons } from "./unavailable";
import { frozenLeftOutNote, frozenStudentIds } from "./frozen";
import { activeTermCode } from "../active-term";

/** The actor's own students (same visibility as the review overview) with two
 * aggregate figures, and the actor's approved policies. Nothing here leaves the
 * server except as counts, aliases and threshold numbers. Frozen students
 * (frozen.ts) are left out, so no criteria-based plan can pull them in; the
 * response says how many. */
export async function loadPlanningScope(actor: ActorContext) {
  requireRole(actor, "faculty");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const department = actor.role === "governance" ? null : (actor.departmentId ?? null);
    const mentor = actor.role === "faculty" ? actor.personId : null;
    const students = await client.query<{ id: string; semester: number; mentor_id: string }>(
      `SELECT s.id,s.semester,m.faculty_person_id AS mentor_id
       FROM student_profiles s JOIN mentor_assignments m ON m.generation_id=s.generation_id AND m.student_id=s.id
       WHERE s.generation_id=$1 AND ($2::uuid IS NULL OR s.department_id=$2) AND ($3::uuid IS NULL OR m.faculty_person_id=$3)
       ORDER BY s.register_number`,
      [generation, department, mentor],
    );
    const everyone = students.rows.map((r) => r.id);
    const frozen = await frozenStudentIds(client, everyone);
    const ids = everyone.filter((id) => !frozen.has(id));
    const term = await activeTermCode(client, generation);
    const attendance = await client.query<{ student_id: string; pct: number }>(
      `SELECT r.student_id,avg(CASE WHEN r.status IN ('present','late') THEN 100.0 ELSE 0.0 END)::float AS pct
       FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id
       JOIN course_offerings co ON co.id=s.course_offering_id JOIN terms t ON t.id=co.term_id
       WHERE t.code=$3 AND t.active AND r.generation_id=$1 AND r.student_id=ANY($2::uuid[])
         AND s.status IN ('submitted','locked') AND r.status<>'excused' GROUP BY r.student_id`,
      [generation, ids, term],
    );
    const marks = await client.query<{ student_id: string; pct: number }>(
      `SELECT m.student_id,avg(m.score / NULLIF(a.maximum_score,0) * 100)::float AS pct
       FROM marks m JOIN assessments a ON a.id=m.assessment_id
       JOIN course_offerings co ON co.id=a.course_offering_id JOIN terms t ON t.id=co.term_id
       WHERE t.code=$3 AND t.active AND m.generation_id=$1 AND m.student_id=ANY($2::uuid[]) AND a.published
       GROUP BY m.student_id`,
      [generation, ids, term],
    );
    const policies = await client.query<{ id: string; faculty_person_id: string; policy: unknown }>(
      `SELECT id,faculty_person_id,policy || scoring AS policy FROM ch11_policies
       WHERE generation_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND ($3::uuid IS NULL OR faculty_person_id=$3)
       ORDER BY created_at DESC`,
      [generation, department, mentor],
    );
    const pct = (rows: Array<{ student_id: string; pct: number }>) =>
      new Map(rows.map((r) => [r.student_id, r.pct]));
    const att = pct(attendance.rows),
      mark = pct(marks.rows);
    const scope: PlanningScope = {
      students: students.rows.filter((r) => !frozen.has(r.id)).map((r) => ({
        id: r.id,
        semester: r.semester,
        attendancePct: att.get(r.id) ?? null,
        markPct: mark.get(r.id) ?? null,
        mentorId: r.mentor_id,
      })),
      policies: policies.rows.flatMap((r) => {
        const parsed = policySchema.safeParse(r.policy);
        return parsed.success
          ? [{ id: r.id, facultyId: r.faculty_person_id, policy: parsed.data }]
          : [];
      }),
    };
    // The privacy guard still knows every mentee's name, frozen or not.
    const roster = await loadGuardRoster(client, generation, everyone, actor.personId, department);
    return {
      scope,
      roster,
      frozenLeftOut: frozen.size,
      ...(frozen.size ? { frozenNote: frozenLeftOutNote(frozen.size) } : {}),
    };
  });
}

const trace = (
  summary: AgentRunSummary,
  questionSource?: "model" | "model+rules",
) => {
  const visible = Object.fromEntries(
    Object.entries(summary).filter(([key]) => key !== "egress"),
  );
  return {
    ...visible,
    ...(questionSource ? { questionSource } : {}),
  } as NonNullable<PlanInput["agent"]>;
};

/** Notes accumulate across revisions, one per line, so earlier answers stay in
 * view of the planner. A client that resends the whole history is not doubled. */
export function mergeNotes(prior: string, next: string): string {
  const a = prior.trim(),
    b = next.trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.startsWith(a)) return b;
  const lines = `${a}\n${b}`.split("\n");
  while (lines.join("\n").length > 1000 && lines.length > 1) lines.shift();
  return lines.join("\n").slice(-1000);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unique = (texts: string[]) => [...new Set(texts)];

/**
 * Free-text request (or natural-language feedback on an existing plan) to a
 * saved plan draft. A new plan goes through the normal create path; feedback
 * revises the SAME plan through the normal revise path (revision + 1, stale
 * and locked checks intact). Every plan is drafted by the AI planner: when no
 * model answers, nothing is saved and the mentor is asked to retry (there is
 * no rule-based parser to fall back to). The planner never locks or executes.
 * Only a mentor (faculty) may create or revise a plan; the department head reads
 * plans and never runs reviews (owner decision, 17 Oct).
 *
 * Scope: the mentor's explicit "Students in scope" selection is authoritative
 * (see planner.ts). A conflict with the request text is stored on the plan and
 * changes nothing until the mentor answers it with `scopeChoice`.
 */
export async function planWithAgent(
  actor: ActorContext,
  raw: unknown,
  options: {
    id?: string;
    expectedRevision?: number;
    commandId?: string;
    endpoints?: Endpoint[];
    chain?: ChainOptions;
  } = {},
) {
  requireRole(actor, "faculty");
  const commandId = options.commandId ?? randomUUID();
  z.string().uuid().parse(commandId);
  const input = withoutAgentFields(planInputSchema.parse(raw));
  const { id, expectedRevision } = options;

  let previous: Awaited<ReturnType<typeof loadPlan>> | undefined;
  if (id) {
    previous = await loadPlan(actor, id);
    if (previous.status === "locked")
      throw new ConflictError("PLAN_LOCKED", "A locked plan cannot be edited; create a new plan");
    if (previous.revision !== expectedRevision)
      throw new ConflictError("STALE_VERSION", "Reload the plan before revising it");
  } else {
    // a retried command returns the plan it already created without re-planning
    const existing = await withCoreTransaction(async (client) =>
      client.query("SELECT id FROM ch11_plans WHERE id=$1 AND created_by=$2", [commandId, actor.personId]),
    );
    if (existing.rowCount) return loadPlan(actor, commandId);
  }
  const before = previous?.body;

  if (input.scopeChoice) {
    if (!before?.scopeConflict || before.scopeConflict.resolution)
      throw new ConflictError("NO_SCOPE_CONFLICT", "There is no open scope question on this plan");
    return answerScopeConflict(actor, before, input.scopeChoice, id, expectedRevision, commandId);
  }

  // Same request, selection, focus, policy and no new note: nothing to re-plan.
  // The saved resolution stays exactly as it was (deterministic, no model call).
  const newNote = !!before && input.feedback !== "" && input.feedback !== before.feedback;
  if (
    previous &&
    before?.agent &&
    !newNote &&
    input.request === before.request &&
    (!input.studentIds || same(input.studentIds, before.studentIds)) &&
    (!input.domain || input.domain === before.domain) &&
    (!input.policyId || input.policyId === before.policyId)
  )
    return previous;

  const endpoints = options.endpoints ?? modelEndpoints("draft");
  const { scope, roster } = await loadPlanningScope(actor);
  const current: PlannerCurrent | undefined = before
    ? {
        domain: before.domain,
        policyId: before.policyId,
        studentIds: before.studentIds,
        filter: before.filter,
      }
    : undefined;
  // Fields the mentor changed by hand are fixed. A student selection is the
  // mentor's own whenever it was typed in or kept from an earlier mentor choice;
  // only a set the planner itself resolved stays open when the form re-sends it.
  const explicitSelection =
    !!input.studentIds &&
    (!same(input.studentIds, before?.studentIds) || before?.scope?.basis !== "criteria");
  const pins: PlannerPins = {
    ...(input.domain && !same(input.domain, before?.domain) ? { domain: input.domain } : {}),
    ...(input.policyId && !same(input.policyId, before?.policyId) ? { policyId: input.policyId } : {}),
    ...(explicitSelection ? { studentIds: input.studentIds } : {}),
  };
  const feedback = mergeNotes(before?.feedback ?? "", input.feedback);
  // A new note answers the questions that were open: the planner treats them as resolved.
  const conflictText = before?.scopeConflict ? scopeConflictQuestion(before.scopeConflict) : "";
  const answered = unique([
    ...(before?.answeredQuestions ?? []),
    ...(newNote ? (before?.agentQuestions ?? []) : []).filter((q) => q !== conflictText),
  ]).slice(-10);
  const conflictKept =
    before?.scopeConflict?.resolution === "kept" &&
    before.request === input.request &&
    same(pins.studentIds ?? before.studentIds, before.studentIds);
  // Aliases depend only on the request, notes and mentor, so the same request
  // always shows the model the same aliases (no per-run random salt).
  const salt = createHash("sha256")
    .update(`${actor.personId}|${input.request}|${feedback}`)
    .digest("hex")
    .slice(0, 8);
  const outcome = await runPlanner({
    request: input.request,
    feedback,
    scope,
    pins,
    current,
    endpoints,
    roster,
    // the planner is interactive: a short wait is absorbed, a long one is reported as a wait (#34)
    options: { wait: "interactive", ...options.chain },
    aliases: buildPlannerAliases(scope, salt),
    answered,
    conflictKept,
  });
  const resolution = outcome.resolution;
  if (!resolution) {
    const reasons = unavailableReasons(outcome.summary);
    try {
      await recordPlannerAudit(actor, id ?? commandId, outcome.summary, { code: "AI_UNAVAILABLE", reasons });
    } catch {
      /* the mentor still gets the retry message */
    }
    if (outcome.summary.fallbackReason?.startsWith("EGRESS_BLOCKED"))
      throw new ConflictError(
        "EGRESS_BLOCKED",
        "The privacy guard stopped this request because it names a student or contact. Describe the students without names or register numbers and save again.",
      );
    const quota = quotaWaitSeconds(outcome.summary);
    if (quota) throw new QuotaWaitError(quota, reasons);
    throw new AiUnavailableError(
      `No AI model answered, so the plan was not saved. Nothing was drafted by rules. Retry in a moment.${
        reasons.length ? ` (${reasons.slice(0, 3).join("; ")})` : ""
      }`,
      reasons,
    );
  }
  const complete = !!(resolution.studentIds && resolution.domain && resolution.policyId);
  const modelAsked = resolution.questions.length;
  const planned: PlanInput = {
    ...input,
    feedback,
    mode: "model",
    ...(resolution.domain ? { domain: resolution.domain } : {}),
    ...(resolution.policyId ? { policyId: resolution.policyId } : {}),
    ...(resolution.studentIds ? { studentIds: resolution.studentIds } : {}),
    ...(resolution.filter ? { filter: resolution.filter } : {}),
    agentQuestions: resolution.questions,
    agentSteps: resolution.steps,
    ...(answered.length ? { answeredQuestions: answered } : {}),
    ...(resolution.scope ? { scope: resolution.scope } : {}),
    ...(resolution.conflict
      ? { scopeConflict: resolution.conflict }
      : conflictKept && before?.scopeConflict
        ? { scopeConflict: before.scopeConflict }
        : {}),
    agent: trace(
      outcome.summary,
      modelAsked >= 2 || (modelAsked > 0 && complete)
        ? "model"
        : modelAsked
          ? "model+rules"
          : complete
            ? "model"
            : "model+rules",
    ),
  };
  const saved = await savePlannedPlan(actor, planned, id, expectedRevision, commandId);
  try {
    await recordPlannerAudit(actor, saved.id, outcome.summary);
  } catch {
    /* the plan is saved; a failed audit write must not discard it */
  }
  return saved;
}

/**
 * The mentor's answer to a scope conflict. No model runs: "keep" leaves the
 * selection exactly as chosen; "switch" adopts the set the request described,
 * re-checked against the mentor's own scope. Only this call changes the scope.
 */
async function answerScopeConflict(
  actor: ActorContext,
  before: NonNullable<Awaited<ReturnType<typeof loadPlan>>["body"]>,
  choice: "keep" | "switch",
  id: string | undefined,
  expectedRevision: number | undefined,
  commandId: string,
) {
  const conflict = before.scopeConflict!;
  let studentIds = before.studentIds;
  if (choice === "switch") {
    if (!conflict.impliedStudentIds)
      throw new ConflictError(
        "SCOPE_TOO_LARGE",
        "The request describes more students than one review covers. Narrow the request instead.",
      );
    const { scope } = await loadPlanningScope(actor);
    const inScope = new Set(scope.students.map((s) => s.id));
    if (!conflict.impliedStudentIds.every((student) => inScope.has(student)))
      throw new ConflictError("SCOPE_CHANGED", "The students the request describes changed. Revise the request.");
    studentIds = conflict.impliedStudentIds;
  }
  const question = scopeConflictQuestion(conflict);
  const planned: PlanInput = {
    request: before.request,
    feedback: before.feedback,
    mode: "model",
    ...(studentIds ? { studentIds } : {}),
    ...(before.domain ? { domain: before.domain } : {}),
    ...(before.policyId ? { policyId: before.policyId } : {}),
    ...(before.filter ? { filter: before.filter } : {}),
    ...(before.agentSteps ? { agentSteps: before.agentSteps } : {}),
    ...(before.agent ? { agent: before.agent } : {}),
    agentQuestions: (before.agentQuestions ?? []).filter((q) => q !== question),
    ...(before.answeredQuestions ? { answeredQuestions: before.answeredQuestions } : {}),
    // a set the mentor confirmed is theirs from here on: later requests that
    // describe something else raise a conflict instead of replacing it
    scope:
      choice === "switch"
        ? { basis: "selected", selected: studentIds?.length ?? 1 }
        : (before.scope ?? { basis: "selected", selected: studentIds?.length ?? 1 }),
    scopeConflict: { ...conflict, resolution: choice === "switch" ? "switched" : "kept" },
  };
  return savePlannedPlan(actor, planned, id, expectedRevision, commandId);
}
