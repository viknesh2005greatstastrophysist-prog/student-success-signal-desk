import { randomUUID } from "node:crypto";
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
  savePlan,
  savePlannedPlan,
} from "./service";
import {
  runPlanner,
  type PlannerCurrent,
  type PlannerPins,
  type PlanningScope,
} from "./planner";
import { modelEndpoints, type ChainOptions, type Endpoint } from "./provider";

const TERM = "2026-ODD";

/** The actor's own students (same visibility as the review overview) with two
 * aggregate figures, and the actor's approved policies. Nothing here leaves the
 * server except as counts, aliases and threshold numbers. */
export async function loadPlanningScope(actor: ActorContext) {
  requireRole(actor, "faculty", "hod", "governance");
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
    const ids = students.rows.map((r) => r.id);
    const attendance = await client.query<{ student_id: string; pct: number }>(
      `SELECT r.student_id,avg(CASE WHEN r.status IN ('present','late') THEN 100.0 ELSE 0.0 END)::float AS pct
       FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id
       JOIN course_offerings co ON co.id=s.course_offering_id JOIN terms t ON t.id=co.term_id
       WHERE t.code=$3 AND t.active AND r.generation_id=$1 AND r.student_id=ANY($2::uuid[])
         AND s.status IN ('submitted','locked') AND r.status<>'excused' GROUP BY r.student_id`,
      [generation, ids, TERM],
    );
    const marks = await client.query<{ student_id: string; pct: number }>(
      `SELECT m.student_id,avg(m.score / NULLIF(a.maximum_score,0) * 100)::float AS pct
       FROM marks m JOIN assessments a ON a.id=m.assessment_id
       JOIN course_offerings co ON co.id=a.course_offering_id JOIN terms t ON t.id=co.term_id
       WHERE t.code=$3 AND t.active AND m.generation_id=$1 AND m.student_id=ANY($2::uuid[]) AND a.published
       GROUP BY m.student_id`,
      [generation, ids, TERM],
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
      students: students.rows.map((r) => ({
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
    const roster = await loadGuardRoster(client, generation, ids, actor.personId, department);
    return { scope, roster };
  });
}

const trace = (
  summary: AgentRunSummary,
  questionSource?: "model" | "rules" | "model+rules",
) => {
  const visible = Object.fromEntries(
    Object.entries(summary).filter(([key]) => key !== "egress"),
  );
  return {
    ...visible,
    ...(questionSource ? { questionSource } : {}),
  } as NonNullable<PlanInput["agent"]>;
};

/**
 * Free-text request (or natural-language feedback on an existing plan) to a
 * saved plan draft. A new plan goes through the normal create path; feedback
 * revises the SAME plan through the normal revise path (revision + 1, stale
 * and locked checks intact). The regex parser remains the labelled fallback
 * whenever the model path is unavailable. The planner never locks or executes.
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
  requireRole(actor, "faculty", "hod", "governance");
  const commandId = options.commandId ?? randomUUID();
  z.string().uuid().parse(commandId);
  const input = withoutAgentFields(planInputSchema.parse(raw));
  const { id, expectedRevision } = options;
  if (input.mode !== "model" || process.env.CH11_PLANNER === "off")
    return savePlan(actor, raw, id, expectedRevision, commandId);

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

  const endpoints = options.endpoints ?? modelEndpoints("draft");
  const { scope, roster } = await loadPlanningScope(actor);
  const before = previous?.body;
  const current: PlannerCurrent | undefined = before
    ? {
        domain: before.domain,
        policyId: before.policyId,
        studentIds: before.studentIds,
        filter: before.filter,
      }
    : undefined;
  // Fields the mentor changed by hand are fixed; unchanged ones stay open to
  // the planner, because a revise form always re-sends the current values.
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const pins: PlannerPins = {
    ...(input.domain && !same(input.domain, before?.domain) ? { domain: input.domain } : {}),
    ...(input.policyId && !same(input.policyId, before?.policyId) ? { policyId: input.policyId } : {}),
    ...(input.studentIds && !same(input.studentIds, before?.studentIds) ? { studentIds: input.studentIds } : {}),
  };
  const outcome = await runPlanner({
    request: input.request,
    feedback: input.feedback,
    scope,
    pins,
    current,
    endpoints,
    roster,
    options: options.chain,
  });
  const resolution = outcome.resolution;
  let planned: PlanInput;
  if (resolution) {
    const complete = !!(resolution.studentIds && resolution.domain && resolution.policyId);
    const modelAsked = resolution.questions.length;
    planned = {
      ...input,
      ...(resolution.domain ? { domain: resolution.domain } : {}),
      ...(resolution.policyId ? { policyId: resolution.policyId } : {}),
      ...(resolution.studentIds ? { studentIds: resolution.studentIds } : {}),
      ...(resolution.filter ? { filter: resolution.filter } : {}),
      agentQuestions: resolution.questions,
      agentSteps: resolution.steps,
      agent: trace(
        outcome.summary,
        modelAsked >= 2 || (modelAsked > 0 && complete)
          ? "model"
          : modelAsked
            ? "model+rules"
            : complete
              ? "model"
              : "rules",
      ),
    };
  } else {
    // Labelled fallback: the mentor's own fields and the regex parser.
    planned = { ...input, agent: trace(outcome.summary, "rules") };
  }
  const saved = await savePlannedPlan(actor, planned, id, expectedRevision, commandId);
  try {
    await recordPlannerAudit(actor, saved.id, outcome.summary);
  } catch {
    /* the plan is saved; a failed audit write must not discard it */
  }
  return saved;
}
