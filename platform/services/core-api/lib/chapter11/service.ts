import { isCollegeProject } from "@aura/contracts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { lmsEvidence } from "../lms-queries";
import { informationalPhrases, sourceInformational } from "../informational";
import { activeTermCode } from "../active-term";
import { collectSnapshot, withCoreTransaction } from "../db";
import { getCurrentGeneration, writeCommandLedger } from "../command-ledger";
import { ConflictError, NotFoundError } from "../http";
import {
  AuthorizationError,
  requireRole,
  requireDemoInstitution,
} from "../security";
import { hashJson } from "../support-commands";
import {
  compose,
  DataBlocked,
  demoPolicy,
  digest,
  formatSkillV2,
  parallelMap,
  planInputSchema,
  planSkill,
  withoutAgentFields,
  type PlanInput,
  policySchema,
  referenceLibrary,
  retrieve,
  riskAnalysis,
  sourceNames,
  sourceSchema,
  validateEvidence,
  type Evidence,
  type Policy,
  type Risk,
  type Source,
  type SourceName,
  type Composer,
  type Reference,
  type PolicyGuard,
} from "./engine";
import { configuredComposer, executionConcurrency, modelEndpoints, type ChainOptions, type Endpoint } from "./provider";
import {
  primedComposer,
  runInvestigation,
  toolAuditRows,
  type ToolEvidence,
} from "./investigator";
import { createInvestigationBackend } from "./investigation-backend";
import { AiUnavailableError, unavailableReasons } from "./unavailable";
import type { JudgeVerdict } from "./judge";
import type { AgentRunSummary, GenerationContext } from "./engine";
import { courseValueKey, type EgressAudit, type GuardRoster } from "./egress";
import { readApprovedCollegeSource } from "../college-normalized";
import { loadAuthenticatedCollegeSources } from "../college-vault";

import {
  reviewGraph,
  collectorNodes,
  executeReviewGraph,
  createNodeRunner,
  type NodeTrace,
} from "./graph";
import { createSourceRegistry, anonymousPriorReference } from "./connectors";
import { evaluationMetrics } from "./metrics";
import { compositeRiskView } from "./dashboard";
import {
  currentEvidenceSql,
  jobEvidenceCapturedSql,
  loadGenerationClock,
  withoutEarlierEvidence,
} from "../data-refresh/generation";
import { persistThenAudit, startLeaseHeartbeat } from "./lease";
import { frozenLeftOutNote, frozenRecordError, frozenStudentIds } from "./frozen";

/** frozenNote: set when frozen students (frozen.ts) were left out of the plan. */
type PlanBody = ReturnType<typeof planSkill> & { frozenNote?: string };
type PlanRow = {
  id: string;
  generation_id: string;
  created_by: string;
  department_id: string;
  revision: number;
  status: string;
  paused: boolean;
  body: PlanBody;
  plan_hash: string;
};
type Job = {
  id: string;
  generation_id: string;
  plan_id: string;
  student_id: string;
  faculty_person_id: string;
  status: string;
  stage: string;
  checkpoint: Checkpoint;
  lease_token: string;
  support_case_id: string | null;
  attempts: number;
};
type ExecutionResult = {
  id: string;
  completed?: boolean;
  escalated?: boolean;
  skipped?: boolean;
  error?: string;
};
type Checkpoint = {
  rejectedEvidence?: Evidence;
  evidence?: Evidence;
  evidenceRevision?: string;
  capturedAt?: string;
  sourceTimings?: Record<string, number>;
  risk?: Risk;
  retrieval?: ReturnType<typeof retrieve>;
  composed?: Awaited<ReturnType<typeof compose>>;
  policy?: Policy;
  policyGuard?: PolicyGuard;
  nodeTrace?: NodeTrace;
  /** numbers appended by the investigator's tools (Brief 12) */
  toolEvidence?: ToolEvidence;
};

async function audit(
  client: PoolClient,
  generation: string,
  actor: ActorContext,
  subject: string,
  event: string,
  input: unknown,
  output: unknown,
) {
  await client.query(
    "INSERT INTO ch11_events(id,generation_id,subject_id,actor_person_id,event_type,input_hash,output_hash,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      randomUUID(),
      generation,
      subject,
      actor.personId,
      event,
      digest(input),
      digest(output),
      JSON.stringify({ input, output }),
    ],
  );
}
function departmentScope(actor: ActorContext, department: string) {
  requireRole(actor, "faculty", "hod", "governance");
  if (actor.role !== "governance" && actor.departmentId !== department)
    throw new AuthorizationError(
      "The requested review is outside your department",
    );
}
async function requireAssignedStudents(
  client: PoolClient,
  generation: string,
  facultyId: string,
  studentIds: string[],
) {
  const assigned = await client.query(
    "SELECT student_id FROM mentor_assignments WHERE generation_id=$1 AND faculty_person_id=$2 AND student_id=ANY($3::uuid[])",
    [generation, facultyId, studentIds],
  );
  if (assigned.rowCount !== studentIds.length)
    throw new AuthorizationError(
      "Every student must be assigned to the selected mentor",
    );
}
async function getPlan(
  client: PoolClient,
  actor: ActorContext,
  id: string,
  lock = false,
): Promise<PlanRow> {
  z.string().uuid().parse(id);
  const generation = await getCurrentGeneration(client);
  const result = await client.query<PlanRow>(
    `SELECT * FROM ch11_plans WHERE id=$1 AND generation_id=$2${lock ? " FOR UPDATE" : ""}`,
    [id, generation],
  );
  if (!result.rowCount) throw new NotFoundError("Review plan not found");
  const plan = result.rows[0]!;
  departmentScope(actor, plan.department_id);
  if (actor.role === "faculty" && plan.created_by !== actor.personId) {
    const policy = await client.query(
      "SELECT id FROM ch11_policies WHERE id=$1 AND faculty_person_id=$2 AND generation_id=$3",
      [plan.body.policyId, actor.personId, generation],
    );
    if (!policy.rowCount)
      throw new AuthorizationError("This plan belongs to another mentor");
  }
  if (actor.role === "faculty" && plan.body.studentIds?.length) {
    await requireAssignedStudents(
      client,
      generation,
      actor.personId,
      plan.body.studentIds,
    );
  }
  return plan;
}

export const approvePolicySchema = z
  .object({
    policy: policySchema,
    facultyId: z.string().uuid().optional(),
    rationale: z.string().trim().min(12).max(600),
  })
  .strict();
export async function approvePolicy(
  actor: ActorContext,
  raw: unknown,
  commandId: string = randomUUID(),
) {
  requireRole(actor, "faculty");
  z.string().uuid().parse(commandId);
  const input = approvePolicySchema.parse(raw);
  const owner = input.facultyId ?? actor.personId;
  if (actor.role === "faculty" && owner !== actor.personId)
    throw new AuthorizationError("Use your own mentor policy");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const permitted = await client.query(
      "SELECT id FROM role_assignments WHERE generation_id=$1 AND person_id=$2 AND department_id=$3 AND role='faculty' AND active",
      [generation, owner, actor.departmentId],
    );
    if (!permitted.rowCount)
      throw new AuthorizationError(
        "Choose an active mentor in your department",
      );
    const id = commandId;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      id,
    ]);
    const prior = await client.query<{
      faculty_person_id: string;
      policy: Policy;
      rationale: string;
    }>(
      "SELECT faculty_person_id,policy,rationale FROM ch11_policies WHERE id=$1 AND generation_id=$2",
      [id, generation],
    );
    if (prior.rowCount) {
      if (
        prior.rows[0]!.faculty_person_id !== owner ||
        digest({
          policy: prior.rows[0]!.policy,
          rationale: prior.rows[0]!.rationale,
        }) !== digest({ policy: input.policy, rationale: input.rationale })
      )
        throw new ConflictError(
          "IDEMPOTENCY_KEY_MISMATCH",
          "This command already approved a different policy",
        );
      return {
        id,
        ...input,
        synthetic: process.env.CORE_IDENTITY_REALM !== "institutional",
      };
    }
    await client.query(
      "INSERT INTO ch11_policies(id,generation_id,department_id,faculty_person_id,policy,rationale,scoring) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb)",
      [
        id,
        generation,
        actor.departmentId,
        owner,
        JSON.stringify(input.policy),
        input.rationale,
        JSON.stringify(
          Object.fromEntries(
            [
              "attendanceWeight",
              "markWeight",
              "inactivityWeight",
              "overdueWeight",
              "internshipWeight",
              "placementWeight",
              "overdueMinimum",
              "internshipMinimum",
              "placementMinimum",
            ].map((key) => [key, input.policy[key as keyof Policy]]),
          ),
        ),
      ],
    );
    await client.query(
      "INSERT INTO ch11_policy_attestations(policy_id,generation_id,approved_by,approved_role,policy_version) VALUES($1,$2,$3,'faculty',$4)",
      [id, generation, actor.personId, input.policy.version],
    );
    await audit(client, generation, actor, id, "policy.approved", input, {
      id,
      synthetic: process.env.CORE_IDENTITY_REALM !== "institutional",
    });
    return {
      id,
      ...input,
      synthetic: process.env.CORE_IDENTITY_REALM !== "institutional",
    };
  });
}

/** Mentor-facing save: agent-only fields in the body are discarded. */
export async function savePlan(
  actor: ActorContext,
  raw: unknown,
  id?: string,
  expectedRevision?: number,
  commandId: string = randomUUID(),
) {
  return persistPlan(
    actor,
    withoutAgentFields(planInputSchema.parse(raw)),
    id,
    expectedRevision,
    commandId,
  );
}
/** Planner-agent save (Brief 13): the same create/revise path, with the agent's
 * questions and trace. Scope, policy ownership and locking are checked exactly
 * as for a mentor's own save; the planner cannot lock or execute. */
export async function savePlannedPlan(
  actor: ActorContext,
  input: PlanInput,
  id?: string,
  expectedRevision?: number,
  commandId: string = randomUUID(),
) {
  return persistPlan(actor, planInputSchema.parse(input), id, expectedRevision, commandId);
}
async function persistPlan(
  actor: ActorContext,
  parsed: PlanInput,
  id: string | undefined,
  expectedRevision: number | undefined,
  commandId: string,
) {
  // Plan commands belong to the assigned mentor. The department head and the
  // AI-activity (governance) roles observe plans but never create or revise them.
  requireRole(actor, "faculty");
  z.string().uuid().parse(commandId);
  // Every review runs on the AI model; the legacy value is only ever read.
  const input: PlanInput = { ...parsed, mode: "model" };
  delete input.scopeChoice;
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    let department = actor.departmentId;
    if (input.policyId) {
      const policy = await client.query<{
        department_id: string;
        faculty_person_id: string;
      }>(
        "SELECT department_id,faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2",
        [input.policyId, generation],
      );
      if (!policy.rowCount)
        throw new NotFoundError("Approved policy not found");
      department = policy.rows[0]!.department_id;
      departmentScope(actor, department);
      if (
        actor.role === "faculty" &&
        policy.rows[0]!.faculty_person_id !== actor.personId
      )
        throw new AuthorizationError("Use your own approved mentor policy");
      if (input.studentIds)
        await requireAssignedStudents(
          client,
          generation,
          policy.rows[0]!.faculty_person_id,
          input.studentIds,
        );
    }
    if (!department) {
      const first = await client.query<{ id: string }>(
        "SELECT id FROM departments WHERE generation_id=$1 ORDER BY code LIMIT 1",
        [generation],
      );
      department = first.rows[0]?.id;
    }
    if (!department)
      throw new ConflictError(
        "DATA_BLOCKED",
        "No active department is available",
      );
    if (input.studentIds) {
      if (new Set(input.studentIds).size !== input.studentIds.length)
        throw new ConflictError(
          "DUPLICATE_STUDENT",
          "Select each student once",
        );
      const found = await client.query(
        "SELECT id FROM student_profiles WHERE generation_id=$1 AND department_id=$2 AND id=ANY($3::uuid[])",
        [generation, department, input.studentIds],
      );
      if (found.rowCount !== input.studentIds.length)
        throw new AuthorizationError(
          "Every student must belong to the policy department",
        );
    }
    // Frozen students (frozen.ts) are left out of every new or revised plan; the
    // plan says so. With nobody left the plan asks which students to cover.
    const frozen = await frozenStudentIds(client, input.studentIds ?? []);
    if (frozen.size) {
      const kept = input.studentIds!.filter((student) => !frozen.has(student));
      input.studentIds = kept.length ? kept : undefined;
    }
    const body: PlanBody = {
      ...planSkill(input),
      ...(frozen.size ? { frozenNote: frozenLeftOutNote(frozen.size) } : {}),
    };
    if (id) {
      const previous = await getPlan(client, actor, id, true);
      if (previous.status === "locked")
        throw new ConflictError(
          "PLAN_LOCKED",
          "A locked plan cannot be edited; create a new plan",
        );
      if (previous.revision !== expectedRevision)
        throw new ConflictError(
          "STALE_VERSION",
          "Reload the plan before revising it",
        );
      await client.query(
        "UPDATE ch11_plans SET body=$2::jsonb,department_id=$3,status=$4,revision=revision+1 WHERE id=$1",
        [
          id,
          JSON.stringify(body),
          department,
          body.ready ? "ready" : "clarifying",
        ],
      );
      await audit(
        client,
        generation,
        actor,
        id,
        "plan.revised",
        previous.body,
        body,
      );
    } else {
      id = commandId;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [id],
      );
      const existing = await client.query<PlanRow>(
        "SELECT * FROM ch11_plans WHERE id=$1 AND generation_id=$2",
        [id, generation],
      );
      if (existing.rowCount) {
        if (
          existing.rows[0]!.created_by !== actor.personId ||
          digest(existing.rows[0]!.body) !== digest(body)
        )
          throw new ConflictError(
            "IDEMPOTENCY_KEY_MISMATCH",
            "This command already created a different plan",
          );
        return existing.rows[0]!;
      }
      await client.query(
        "INSERT INTO ch11_plans(id,generation_id,created_by,department_id,status,body) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [
          id,
          generation,
          actor.personId,
          department,
          body.ready ? "ready" : "clarifying",
          JSON.stringify(body),
        ],
      );
      await audit(client, generation, actor, id, "plan.created", input, body);
    }
    return getPlan(client, actor, id);
  });
}
export async function lockPlan(
  actor: ActorContext,
  id: string,
  expectedRevision: number,
) {
  requireRole(actor, "faculty");
  return withCoreTransaction(async (client) => {
    const plan = await getPlan(client, actor, id, true);
    if (plan.status === "locked") return plan;
    if (plan.revision !== expectedRevision)
      throw new ConflictError(
        "STALE_VERSION",
        "Reload the plan before locking it",
      );
    if (!plan.body.ready)
      throw new ConflictError(
        "CLARIFICATION_REQUIRED",
        "Answer the planning questions before locking",
      );
    const policy = await client.query<{ faculty_person_id: string }>(
      "SELECT faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2",
      [plan.body.policyId, plan.generation_id],
    );
    if (!policy.rowCount)
      throw new ConflictError(
        "POLICY_REQUIRED",
        "A mentor-approved policy is required",
      );
    // A plan saved before a student was frozen still names them: lock without
    // them and record why on the plan (frozen.ts).
    const frozen = await frozenStudentIds(client, plan.body.studentIds ?? []);
    const students = (plan.body.studentIds ?? []).filter((student) => !frozen.has(student));
    if (frozen.size && !students.length) throw frozenRecordError();
    const body: PlanBody = frozen.size
      ? { ...plan.body, studentIds: students, frozenNote: frozenLeftOutNote(frozen.size) }
      : plan.body;
    await client.query(
      "UPDATE ch11_plans SET status='locked',body=$3::jsonb,plan_hash=$2,locked_at=now(),revision=revision+1 WHERE id=$1",
      [id, digest(body), JSON.stringify(body)],
    );
    for (const student of students)
      await client.query(
        "INSERT INTO ch11_jobs(id,generation_id,plan_id,student_id,faculty_person_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          plan.generation_id,
          id,
          student,
          policy.rows[0]!.faculty_person_id,
        ],
      );
    await audit(
      client,
      plan.generation_id,
      actor,
      id,
      "plan.locked",
      plan.body,
      { hash: digest(body), students },
    );
    return getPlan(client, actor, id);
  });
}

/** The only four-source access surface used by Chapter 11 workers. */
async function defaultSourceAdapter(
  actor: ActorContext,
  studentId: string,
  source: SourceName,
): Promise<Source> {
  if (process.env.CORE_IDENTITY_REALM === "institutional") {
    z.string().uuid().parse(studentId);
    z.enum(sourceNames).parse(source);
    if (source === "lms") {
      const scope = await loadAuthenticatedCollegeSources(actor);
      if (!scope.students.some((s) => s.id === studentId))
        throw new AuthorizationError(
          "LMS source is outside the current college assignment",
        );
      const native = await withCoreTransaction(async (client) =>
        lmsEvidence(client, await getCurrentGeneration(client), studentId),
      );
      if (native.state === "present") return native;
    }
    return readApprovedCollegeSource(actor, studentId, source);
  }
  z.string().uuid().parse(studentId);
  z.enum(sourceNames).parse(source);
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const row = await client.query<{ department_id: string }>(
      "SELECT department_id FROM student_profiles WHERE generation_id=$1 AND id=$2",
      [generation, studentId],
    );
    if (!row.rowCount) throw new NotFoundError("Student not found");
    departmentScope(actor, row.rows[0]!.department_id);
    if (actor.role === "faculty")
      await requireAssignedStudents(client, generation, actor.personId, [
        studentId,
      ]);
    if (source === "lms") return lmsEvidence(client, generation, studentId);
    if (source !== "academic") {
      const record = await client.query<{ record: Source }>(
        "SELECT record FROM ch11_sources WHERE generation_id=$1 AND student_id=$2 AND source=$3",
        [generation, studentId, source],
      );
      if (!record.rowCount)
        throw new DataBlocked([`${source}: no linked authorized record`]);
      // Registration, status and evaluation (internship) or readiness, applications and
      // interview outcomes (placement), with source and date: informational, never scored.
      const informational = await sourceInformational(
        client,
        generation,
        studentId,
        source,
      );
      return sourceSchema.parse({
        ...record.rows[0]!.record,
        ...(informational ? { informational } : {}),
      });
    }
    const term = await activeTermCode(client, generation);
    const records = await client.query<{
      kind: string;
      value: number;
      record_id: string;
      observed_at: Date;
      course: string;
    }>(
      `SELECT 'attendance' AS kind, CASE WHEN r.status IN ('present','late') THEN 100.0 ELSE 0.0 END AS value,r.id::text AS record_id,s.session_date::timestamptz AS observed_at,cc.code AS course
       FROM attendance_records r JOIN attendance_sessions s ON s.id=r.attendance_session_id
       JOIN course_offerings co ON co.id=s.course_offering_id JOIN courses cc ON cc.id=co.course_id JOIN terms t ON t.id=co.term_id
       WHERE t.code=$3 AND t.active AND r.generation_id=$1 AND r.student_id=$2 AND s.status IN ('submitted','locked') AND r.status<>'excused'
       UNION ALL SELECT 'mark', (m.score / NULLIF(a.maximum_score,0) * 100)::float,m.id::text,m.recorded_at,cc.code
       FROM marks m JOIN assessments a ON a.id=m.assessment_id JOIN course_offerings co ON co.id=a.course_offering_id JOIN courses cc ON cc.id=co.course_id JOIN terms t ON t.id=co.term_id WHERE t.code=$3 AND t.active AND m.generation_id=$1 AND m.student_id=$2 AND a.published`,
      [generation, studentId, term],
    );
    const attendance = records.rows.filter((r) => r.kind === "attendance");
    const marks = records.rows.filter((r) => r.kind === "mark");
    const average = (rows: typeof records.rows) =>
      rows.reduce((sum, r) => sum + Number(r.value), 0) / rows.length;
    // Per-course breakdown (Brief 11): lets a draft name the driving course.
    const perCourse: Record<string, number> = {};
    for (const [metric, rows] of [
      ["attendancePct", attendance],
      ["markPct", marks],
    ] as const) {
      const byCourse = new Map<string, typeof records.rows>();
      for (const r of rows)
        if (r.course) byCourse.set(r.course, [...(byCourse.get(r.course) ?? []), r]);
      if (byCourse.size > 1)
        for (const [course, group] of byCourse)
          perCourse[courseValueKey(metric, course)] = average(group);
    }
    const lineage: Record<string, string | number | boolean> = {};
    if (isCollegeProject()) {
      const raw = await client.query<{
        dataset_hash: string;
        student: { reports: Array<{ sourceId: string; courses: unknown[] }> };
        attendance_from_report: boolean;
      }>(
        // `attendance_from_report`: this student's attendance was rebuilt from the college attendance report
        // (data generation realistic-v3 wrote records for them; student 021 was left as generated).
        "SELECT d.dataset_hash,student,EXISTS(SELECT 1 FROM data_generations g JOIN attendance_records ar ON ar.generation_id=g.generation_id AND ar.student_id::text=$2 AND ar.recorded_at>=g.as_of WHERE g.generation_id=d.id AND g.label='realistic-v3') AS attendance_from_report FROM project_dataset d CROSS JOIN LATERAL jsonb_array_elements(d.review->'students') student WHERE d.id=$1 AND student->>'id'=$2",
        [generation, studentId],
      );
      if (!raw.rowCount)
        throw new DataBlocked([
          "Original college source identity is missing from the project dataset",
        ]);
      const original = raw.rows[0]!;
      Object.assign(lineage, {
        origin: "generated_project_operations",
        collegeDatasetHash: original.dataset_hash,
        rawSourceValueCount: original.student.reports.reduce(
          (n, r) => n + r.courses.length,
          0,
        ),
        rawSourceHashes: [
          ...new Set(original.student.reports.map((r) => r.sourceId)),
        ].join(","),
        rawSourceDefinitionsKnown: false,
        // Provenance of the attendance figures: built from the college attendance report, not raw register entries.
        ...(original.attendance_from_report && attendance.length
          ? { attendanceBasis: "college_attendance_report" }
          : {}),
      });
    }
    return sourceSchema.parse({
      source,
      studentId,
      recordId:
        records.rows
          .map((r) => r.record_id)
          .sort()
          .join(",") || "missing",
      observedAt: records.rows.length
        ? new Date(
            Math.max(
              ...records.rows.map((r) => new Date(r.observed_at).getTime()),
            ),
          ).toISOString()
        : new Date().toISOString(),
      semester: term,
      state: attendance.length && marks.length ? "present" : "missing",
      synthetic: true,
      values: {
        ...(attendance.length ? { attendancePct: average(attendance) } : {}),
        ...(marks.length ? { markPct: average(marks) } : {}),
        ...perCourse,
        ...lineage,
      },
    });
  });
}

export const sourceAdapterRegistry = createSourceRegistry(
  defaultSourceAdapter,
  defaultPriorAdapter,
);
async function authorizeConnector(
  client: PoolClient,
  actor: ActorContext,
  studentId: string,
) {
  const generation = await getCurrentGeneration(client);
  const student = (
    await client.query(
      "SELECT department_id FROM student_profiles WHERE id=$1 AND generation_id=$2",
      [studentId, generation],
    )
  ).rows[0];
  if (!student) throw new NotFoundError("Student not found");
  departmentScope(actor, student.department_id);
  if (actor.role === "faculty")
    await requireAssignedStudents(client, generation, actor.personId, [
      studentId,
    ]);
  return { generation, departmentId: student.department_id };
}
export function readSource(
  actor: ActorContext,
  studentId: string,
  source: SourceName,
): Promise<Source>;
export function readSource(
  actor: ActorContext,
  studentId: string,
  source: "priorInterventions",
): Promise<Reference[]>;
export async function readSource(
  actor: ActorContext,
  studentId: string,
  source: SourceName | "priorInterventions",
): Promise<Source | Reference[]> {
  if (source === "priorInterventions")
    return readPriorInterventions(actor, studentId);
  z.string().uuid().parse(studentId);
  z.enum(sourceNames).parse(source);
  await withCoreTransaction((client) =>
    authorizeConnector(client, actor, studentId),
  );
  const result = sourceSchema.parse(
    await sourceAdapterRegistry.read(actor, studentId, source),
  );
  if (result.studentId !== studentId || result.source !== source)
    throw new DataBlocked([
      "Connector returned evidence outside the authorized request",
    ]);
  return result;
}
/** Scoped history connector. The model receives catalogue actions, never names,
 * identifiers, arbitrary outcome prose, raw grades or another student's metrics. */
async function defaultPriorAdapter(
  actor: ActorContext,
  studentId: string,
): Promise<Reference[]> {
  z.string().uuid().parse(studentId);
  return withCoreTransaction(async (client) => {
    const { generation, departmentId } = await authorizeConnector(
      client,
      actor,
      studentId,
    );
    const records = await client.query(
      `SELECT p.id,p.plan FROM support_plans p JOIN student_profiles s ON s.id=p.student_id JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE p.generation_id=$1 AND s.department_id=$2 AND d.decision='approved' AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.generation_id=$1 AND m.student_id=s.id AND m.faculty_person_id=$3)) ORDER BY p.created_at DESC LIMIT 100`,
      [
        generation,
        departmentId,
        actor.role === "faculty" ? actor.personId : null,
      ],
    );
    const references = records.rows.map((row) =>
      anonymousPriorReference(
        row.id,
        (row.plan.actions ?? []).map((a: { code: string }) => a.code),
        departmentId,
      ),
    );

    return references;
  });
}

export async function readPriorInterventions(
  actor: ActorContext,
  studentId: string,
): Promise<Reference[]> {
  const scope = await withCoreTransaction((c) =>
    authorizeConnector(c, actor, studentId),
  );
  const records = await sourceAdapterRegistry.readPrior(actor, studentId);
  const references = records
    .filter((r) => r.departmentId === scope.departmentId)
    .map((r) =>
      anonymousPriorReference(r.id, r.actionCodes ?? [], scope.departmentId),
    );
  await withCoreTransaction((c) =>
    audit(
      c,
      scope.generation,
      actor,
      studentId,
      "connector.priorInterventions",
      {
        source: "priorInterventions",
        studentId,
        departmentId: scope.departmentId,
      },
      {
        referenceIds: references.map((r) => r.id),
        count: references.length,
        anonymousCatalogueOnly: true,
      },
    ),
  );
  return references;
}

export async function seedChapterSources(actor: ActorContext) {
  requireDemoInstitution();
  requireRole(actor, "governance");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const students = await client.query<{
      id: string;
      register_number: string;
    }>(
      "SELECT id,register_number FROM student_profiles WHERE generation_id=$1 ORDER BY register_number",
      [generation],
    );
    const semester = await activeTermCode(client, generation);
    let inserted = 0;
    for (const [index, student] of students.rows.entries()) {
      for (const source of ["lms", "internship", "placement"] as const) {
        const id = randomUUID();
        const values =
          source === "lms"
            ? {
                inactivityDays: index % 3 === 0 ? 9 : 2,
                overdueAssignments: index % 3 === 0 ? 2 : 0,
              }
            : source === "internship"
              ? { missedMilestones: index % 4 === 0 ? 1 : 0 }
              : { missedActivities: index % 5 === 0 ? 1 : 0 };
        const record = {
          source,
          studentId: student.id,
          recordId: `CH11-SYNTHETIC-${student.register_number}-${source}`,
          observedAt: new Date().toISOString(),
          semester,
          state: "present",
          synthetic: true,
          values,
        };
        const result = await client.query(
          "INSERT INTO ch11_sources(id,generation_id,student_id,source,record) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",
          [id, generation, student.id, source, JSON.stringify(record)],
        );
        inserted += result.rowCount ?? 0;
      }
    }
    await audit(
      client,
      generation,
      actor,
      generation,
      "sources.synthetic_linked",
      { fixtureVersion: "CH11-SYNTHETIC-1" },
      { inserted },
    );
    return { inserted, synthetic: true };
  });
}

/** One append-only audit row per outbound (non-loopback) model request:
 * payload hash, field list and byte size, or the blocked category. */
async function recordEgress(
  actor: ActorContext,
  job: Job,
  provenance: { egress: EgressAudit[] } | undefined,
) {
  const rows = provenance?.egress ?? [];
  if (!rows.length) return;
  await withCoreTransaction(async (client) => {
    for (const row of rows)
      await audit(
        client,
        job.generation_id,
        actor,
        job.id,
        row.outcome === "blocked" ? "model.egress_blocked" : "model.egress",
        row,
        row.outcome === "blocked"
          ? { code: "EGRESS_BLOCKED", category: row.category }
          : { outcome: "sent" },
      );
  });
}
/** The judge's scores and reasons (every round) and any fault the test harness
 * injected, as durable audit rows. An unavailable judge is recorded as such. */
async function recordJudgeAudit(
  actor: ActorContext,
  job: Job,
  validation: {
    judge?: JudgeVerdict;
    provenance?: { injected?: Array<{ kind: string; note: string }> };
  },
) {
  const rounds = [validation.judge?.previous, validation.judge].filter(
    (v): v is JudgeVerdict => !!v,
  );
  const injected = validation.provenance?.injected ?? [];
  if (!rounds.length && !injected.length) return;
  await withCoreTransaction(async (client) => {
    for (const v of rounds)
      await audit(
        client,
        job.generation_id,
        actor,
        job.id,
        v.status === "scored" ? "agent.judge" : "agent.judge_unavailable",
        { role: "judge", round: v.round, provider: v.provider, model: v.model },
        v.status === "scored"
          ? {
              scores: v.scores,
              reasons: v.reasons,
              min: v.min,
              mean: v.mean,
              passed: v.passed,
              threshold: v.threshold,
              repair: v.repair ?? null,
              injected: v.injected ?? false,
            }
          : {
              code: "JUDGE_UNAVAILABLE",
              reason: v.unavailableReason,
              note: "judge unavailable; the draft was not blocked",
            },
      );
    for (const fault of injected)
      await audit(client, job.generation_id, actor, job.id, "fault.injected", { kind: fault.kind }, { note: fault.note });
  });
}
/** Identities the egress guard must refuse to send (never sent themselves):
 * the scoped students, their parents, the mentor, the department and college. */
export async function loadGuardRoster(
  client: PoolClient,
  generation: string,
  studentIds: string[],
  facultyPersonId: string,
  departmentId: string | null,
): Promise<GuardRoster> {
  const identities = await client.query<{
    name: string | null;
    email: string | null;
    register: string | null;
    phrase: string | null;
  }>(
    `SELECT p.display_name AS name,p.email,sp.register_number AS register,NULL AS phrase FROM student_profiles sp JOIN people p ON p.id=sp.person_id WHERE sp.generation_id=$1 AND sp.id=ANY($2::uuid[])
       UNION ALL SELECT p.display_name,p.email,NULL,NULL FROM parent_links pl JOIN people p ON p.id=pl.parent_person_id WHERE pl.generation_id=$1 AND pl.student_id=ANY($2::uuid[])
       UNION ALL SELECT p.display_name,p.email,NULL,NULL FROM people p WHERE p.id=$3
       UNION ALL SELECT NULL,NULL,NULL,d.name FROM departments d WHERE d.id=$4
       UNION ALL SELECT NULL,NULL,NULL,i.name FROM departments d JOIN institutions i ON i.id=d.institution_id WHERE d.id=$4`,
    [generation, studentIds, facultyPersonId, departmentId],
  );
  // Internship organisations of the scoped students are blocked too (P2-5): no payload
  // builder includes them, and this keeps it that way.
  const organisations = await informationalPhrases(client, generation, studentIds);
  return {
    names: identities.rows.flatMap((r) => (r.name ? [r.name] : [])),
    emails: identities.rows.flatMap((r) => (r.email ? [r.email] : [])),
    registers: identities.rows.flatMap((r) => (r.register ? [r.register] : [])),
    phrases: [
      ...identities.rows.flatMap((r) => (r.phrase ? [r.phrase] : [])),
      ...organisations,
    ],
  };
}
export async function loadPlan(actor: ActorContext, id: string) {
  requireRole(actor, "faculty", "hod", "governance");
  return withCoreTransaction((client) => getPlan(client, actor, id));
}
/** Audit rows for a planner run: one per tool call plus the sealed payloads. */
export async function recordPlannerAudit(
  actor: ActorContext,
  planId: string,
  summary: AgentRunSummary,
  /** set when no model answered: the audited reason the mentor is asked to retry */
  failure?: { code: string; reasons: string[] },
) {
  await withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    if (failure)
      await audit(
        client,
        generation,
        actor,
        planId,
        "planner.unavailable",
        { role: summary.role },
        failure,
      );
    for (const row of toolAuditRows(summary))
      await audit(client, generation, actor, planId, row.event.replace("agent.", "planner."), row.input, row.output);
    for (const row of summary.egress)
      await audit(
        client,
        generation,
        actor,
        planId,
        row.outcome === "blocked" ? "model.egress_blocked" : "model.egress",
        row,
        row.outcome === "blocked"
          ? { code: "EGRESS_BLOCKED", category: row.category }
          : { outcome: "sent" },
      );
  });
}

/** One durable audit row per investigator tool call, executed or refused. */
async function recordAgentAudit(
  actor: ActorContext,
  job: Job,
  summary: AgentRunSummary,
) {
  const rows = toolAuditRows(summary);
  if (!rows.length) return;
  await withCoreTransaction(async (client) => {
    for (const row of rows)
      await audit(client, job.generation_id, actor, job.id, row.event, row.input, row.output);
  });
}
async function saveCheckpoint(
  actor: ActorContext,
  job: Job,
  stage: string,
  checkpoint: Checkpoint,
) {
  await withCoreTransaction(async (client) => {
    if ((await getCurrentGeneration(client)) !== job.generation_id)
      throw new ConflictError(
        "GENERATION_CHANGED",
        "The synthetic generation changed during execution",
      );
    const saved = await client.query(
      "UPDATE ch11_jobs SET checkpoint=$2::jsonb,stage=$3,updated_at=now(),lease_until=now()+interval '180 seconds' WHERE id=$1 AND lease_token=$4 AND status='running' RETURNING id",
      [job.id, JSON.stringify(checkpoint), stage, job.lease_token],
    );
    if (!saved.rowCount)
      throw new ConflictError("LEASE_LOST", "Another executor owns this job");
    await audit(
      client,
      job.generation_id,
      actor,
      job.id,
      `checkpoint.${stage}`,
      { stage: job.stage, checkpoint: job.checkpoint },
      checkpoint,
    );
  });
  job.checkpoint = checkpoint;
  job.stage = stage;
}

/** Heartbeat renewal: extends the lease only while this executor still owns the
 * running job. Resolves false once the lease has been lost or the job has ended. */
async function renewLease(job: Job): Promise<boolean> {
  return withCoreTransaction(async (client) => {
    const renewed = await client.query(
      "UPDATE ch11_jobs SET lease_until=now()+interval '180 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
      [job.id, job.lease_token],
    );
    return (renewed.rowCount ?? 0) > 0;
  });
}

async function publishDraft(actor: ActorContext, job: Job, plan: PlanRow) {
  return withCoreTransaction(async (client) => {
    const activePlan = await getPlan(client, actor, plan.id, true);
    if (activePlan.paused)
      throw new ConflictError(
        "PLAN_PAUSED",
        "Review paused before publishing its suggestion",
      );
    const current = await client.query<Job>(
      "SELECT * FROM ch11_jobs WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
      [job.id, job.lease_token],
    );
    if (!current.rowCount)
      throw new ConflictError("LEASE_LOST", "Another executor owns this job");
    if ((await getCurrentGeneration(client)) !== job.generation_id)
      throw new ConflictError("GENERATION_CHANGED", "The generation changed");
    await requireAssignedStudents(
      client,
      job.generation_id,
      job.faculty_person_id,
      [job.student_id],
    );
    const cp = job.checkpoint;
    if (!cp.risk?.flagged) {
      await client.query(
        "UPDATE ch11_jobs SET status='not_flagged',stage='complete',lease_until=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
      await audit(
        client,
        job.generation_id,
        actor,
        job.id,
        "review.not_flagged",
        cp,
        { noRecommendation: true },
      );
      return;
    }
    if (!cp.composed?.validation.valid)
      throw new ConflictError(
        "VALIDATION_REQUIRED",
        "A passing acceptance report is required before mentor review",
      );
    const caseId = randomUUID(),
      snapshotId = randomUUID(),
      runId = randomUUID(),
      artifactId = randomUUID();
    const reason = cp.risk.signals.map((s) => s.explanation).join(" ");
    const evidence = {
      ...cp.evidence,
      ...(cp.toolEvidence ? { tools: cp.toolEvidence } : {}),
      assignedFacultyPersonId: job.faculty_person_id,
      planId: plan.id,
      planHash: plan.plan_hash,
      domain: plan.body.domain,
      policy: cp.policy,
      risk: cp.risk,
      policyGuard: cp.policyGuard,
      retrieval: cp.retrieval,
      chapterJobId: job.id,
    };
    const inputHash = hashJson(evidence),
      contentHash = hashJson(cp.composed.packet);
    await client.query(
      "INSERT INTO support_cases(id,generation_id,student_id,source,status,risk_band,reason) VALUES($1,$2,$3,$4,'awaiting_faculty',$5,$6)",
      [
        caseId,
        job.generation_id,
        job.student_id,
        `chapter11:${plan.id}`,
        cp.risk.band,
        reason,
      ],
    );
    if (!cp.evidenceRevision)
      throw new ConflictError(
        "EVIDENCE_REVISION_REQUIRED",
        "Recollect evidence before publishing this resumed job",
      );
    // The snapshot carries the time the evidence was collected, not the publish time,
    // so a draft is "Current figures" only when its numbers are (review R-04).
    await client.query(
      "INSERT INTO evidence_snapshots(id,generation_id,support_case_id,institution_revision,input_hash,evidence,captured_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,COALESCE($7::timestamptz,now()))",
      [
        snapshotId,
        job.generation_id,
        caseId,
        cp.evidenceRevision,
        inputHash,
        JSON.stringify(evidence),
        cp.capturedAt ?? null,
      ],
    );
    await client.query(
      "INSERT INTO agent_runs(id,generation_id,support_case_id,evidence_snapshot_id,mode,model_id,status,completed_at) VALUES($1,$2,$3,$4,$5,$6,'validated',now())",
      [
        runId,
        job.generation_id,
        caseId,
        snapshotId,
        cp.composed.mode,
        cp.composed.modelId,
      ],
    );
    await client.query(
      "INSERT INTO agent_artifacts(id,generation_id,agent_run_id,artifact_version,content_hash,recommendation,validation) VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb)",
      [
        artifactId,
        job.generation_id,
        runId,
        contentHash,
        JSON.stringify(cp.composed.packet),
        JSON.stringify({
          ...cp.composed.validation,
          policyVersion: cp.policy!.version,
          chapter11: true,
        }),
      ],
    );
    await client.query(
      "UPDATE ch11_jobs SET status='awaiting_faculty',stage='complete',support_case_id=$2,lease_until=NULL,updated_at=now() WHERE id=$1",
      [job.id, caseId],
    );
    await writeCommandLedger(client, {
      generationId: job.generation_id,
      commandId: job.id,
      actorPersonId: actor.personId,
      aggregateType: "support_case",
      aggregateId: caseId,
      eventType: "support.proposed",
      action: "chapter11_review",
      topic: "support.proposal.created",
      payload: {
        studentId: job.student_id,
        departmentId: plan.department_id,
        facultyPersonId: job.faculty_person_id,
        supportCase: { id: caseId },
        runId,
        artifactId,
      },
      metadata: { planId: plan.id, jobId: job.id, inputHash, contentHash },
    });
    await audit(
      client,
      job.generation_id,
      actor,
      job.id,
      "mentor.interrupt",
      cp,
      { caseId, runId, artifactId, contentHash },
    );
  });
}

export async function executePlan(
  actor: ActorContext,
  planId: string,
  options: {
    concurrency?: number;
    composer?: Composer;
    stopAfterStage?: string;
    collectorConcurrency?: 1 | 4;
    /** test hook: endpoints and limiter for the tool-using investigator */
    investigation?: { endpoints?: Endpoint[]; chain?: ChainOptions };
  } = {},
) {
  requireRole(actor, "faculty");
  const start = performance.now();
  // a budgeted remote model runs one review per request: its tokens-per-minute window cannot serve more (E2E log #33)
  const batchSize = options.concurrency === undefined && executionConcurrency(4) === 1 ? 1 : 4;
  const initial = await withCoreTransaction(async (client) => {
    const plan = await getPlan(client, actor, planId);
    if (plan.paused)
      throw new ConflictError(
        "PLAN_PAUSED",
        "This review is paused. Resume it before continuing.",
      );
    if (plan.status !== "locked" || digest(plan.body) !== plan.plan_hash)
      throw new ConflictError(
        "PLAN_NOT_LOCKED",
        "Lock a valid plan before execution",
      );
    const policy = await client.query<{
      policy: Policy;
      faculty_person_id: string;
    }>(
      "SELECT policy || scoring AS policy,faculty_person_id FROM ch11_policies WHERE id=$1 AND generation_id=$2",
      [plan.body.policyId, plan.generation_id],
    );
    if (!policy.rowCount)
      throw new ConflictError("POLICY_REQUIRED", "Approved policy missing");
    await requireAssignedStudents(
      client,
      plan.generation_id,
      policy.rows[0]!.faculty_person_id,
      plan.body.studentIds!,
    );
    // A job at the attempt limit is never reclaimable, so one whose executor died
    // would stay 'running' forever. Move it to the terminal needs-human state.
    const expired = await client.query<{
      id: string;
      stage: string;
      attempts: number;
    }>(
      "UPDATE ch11_jobs SET status='failed',error_code='LEASE_EXPIRED',escalated_at=now(),failure_diagnosis=jsonb_build_object('code','LEASE_EXPIRED','attempts',attempts,'reasons','[]'::jsonb),lease_until=NULL,updated_at=now() WHERE plan_id=$1 AND generation_id=$2 AND status='running' AND lease_until<now() AND attempts>=3 AND escalated_at IS NULL RETURNING id,stage,attempts",
      [plan.id, plan.generation_id],
    );
    for (const row of expired.rows)
      await audit(
        client,
        plan.generation_id,
        actor,
        row.id,
        "execution.stopped",
        { stage: row.stage },
        { code: "LEASE_EXPIRED", reasons: [] },
      );
    // A job for a frozen student (frozen.ts), locked before the freeze, is never run.
    const frozen = await frozenStudentIds(client, plan.body.studentIds!);
    const jobs = await client.query<{ id: string }>(
      `SELECT id FROM ch11_jobs WHERE plan_id=$1 AND generation_id=$2 AND escalated_at IS NULL AND attempts<3 AND (status IN ('queued','blocked','failed') OR (status='running' AND lease_until<now())) AND NOT student_id=ANY($3::uuid[]) ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,updated_at,student_id LIMIT ${batchSize}`,
      [plan.id, plan.generation_id, [...frozen]],
    );
    const attestation = await client.query(
      "SELECT approved_role,policy_version FROM ch11_policy_attestations WHERE policy_id=$1 AND generation_id=$2",
      [plan.body.policyId, plan.generation_id],
    );
    const approved = attestation.rows[0];
    const parsed = policySchema.parse(policy.rows[0]!.policy);
    // Identities the egress guard must refuse to send (never sent themselves).
    const roster = await loadGuardRoster(
      client,
      plan.generation_id,
      plan.body.studentIds!,
      policy.rows[0]!.faculty_person_id,
      plan.department_id,
    );
    return {
      plan,
      roster,
      policy: parsed,
      policyGuard: {
        version: approved?.policy_version ?? "",
        facultyApproved: approved?.approved_role === "faculty",
      },
      jobs: jobs.rows,
    };
  });
  const results = await parallelMap(
    initial.jobs,
    options.concurrency ?? executionConcurrency(initial.plan.body.budget.concurrency),
    async ({ id }): Promise<ExecutionResult> => {
      const job = await withCoreTransaction(async (client) => {
        const plan = await getPlan(client, actor, planId, true);
        if (plan.paused) return undefined;
        const lease = randomUUID();
        const claimed = await client.query<Job>(
          "UPDATE ch11_jobs SET status='running',lease_token=$2,lease_until=now()+interval '180 seconds',attempts=attempts+1,error_code=NULL WHERE id=$1 AND escalated_at IS NULL AND attempts<3 AND (status IN ('queued','blocked','failed') OR (status='running' AND lease_until<now())) RETURNING *",
          [id, lease],
        );
        const row = claimed.rows[0];
        // Evidence collected before the current data generation is never reused
        // (review R-04): the review collects today's figures again.
        if (row) row.checkpoint = withoutEarlierEvidence(await loadGenerationClock(client), row.checkpoint);
        return row;
      });
      if (!job) return { id, skipped: true };
      // Keep the lease alive through slow collection and model calls.
      const heartbeat = startLeaseHeartbeat(() => renewLease(job));
      try {
        const trace: NodeTrace = job.checkpoint.nodeTrace ?? {};
        job.checkpoint.nodeTrace = trace;
        const runNode = createNodeRunner(trace);
        const result = (await executeReviewGraph(
          {
            Coordinator: () => ensureReviewRunning(actor, planId),
            EvidenceValidator: async () => {
              validateEvidence(
                job.checkpoint.evidence!,
                job.student_id,
                initial.policy,
                job.checkpoint.capturedAt!,
                job.checkpoint.evidence!.academic.semester,
              );
              job.checkpoint.policyGuard = initial.policyGuard;
              await saveCheckpoint(actor, job, "risk", job.checkpoint);
              if (options.stopAfterStage === "risk")
                throw new Error("INJECTED_STOP");
            },
            RiskAnalysisAgent: async () => {
              await ensureReviewRunning(actor, planId);
              job.checkpoint.risk ??= riskAnalysis(
                job.checkpoint.evidence!,
                initial.policy,
              );
            },
            HistoryRetriever: async () => {
              if (!job.checkpoint.retrieval) {
                const history = await readSource(
                  actor,
                  job.student_id,
                  "priorInterventions",
                );
                job.checkpoint.retrieval = retrieve(
                  [
                    job.checkpoint
                      .risk!.signals.map((s) => s.explanation)
                      .join(" "),
                    initial.plan.body.feedback,
                  ].join(" "),
                  [initial.plan.body.domain!],
                  [...referenceLibrary, ...history],
                  initial.plan.department_id,
                  job.student_id,
                );
              }
              await saveCheckpoint(actor, job, "recommend", job.checkpoint);
              if (options.stopAfterStage === "recommend")
                throw new Error("INJECTED_STOP");
            },
            RecommendationAgent: async () => {
              await ensureReviewRunning(actor, planId);
              if (job.checkpoint.risk!.flagged && !job.checkpoint.composed) {
                // Every review runs on an AI model; none configured is "AI unavailable".
                const provider = options.composer ?? configuredComposer();
                const baseContext: GenerationContext = {
                  evidence: job.checkpoint.evidence!,
                  risk: job.checkpoint.risk!,
                  domain: initial.plan.body.domain!,
                  references: job.checkpoint.retrieval!,
                  policyGuard: initial.policyGuard,
                  policy: initial.policy,
                  roster: initial.roster,
                  baseline: formatSkillV2(
                    job.checkpoint.risk!,
                    initial.plan.body.domain!,
                    job.checkpoint.evidence!,
                  ),
                };
                let context = baseContext;
                let composer = provider;
                const investigate =
                  !!provider &&
                  (!!options.investigation || !options.composer) &&
                  process.env.CH11_INVESTIGATOR !== "off";
                if (investigate) {
                  const outcome = await runNode("InvestigatorAgent", async () => {
                    const endpoints =
                      options.investigation?.endpoints ?? modelEndpoints("draft");
                    const authorize = () =>
                      withCoreTransaction((client) =>
                        authorizeConnector(client, actor, job.student_id),
                      );
                    return runInvestigation({
                      context: baseContext,
                      endpoints,
                      studentId: job.student_id,
                      capturedAt: job.checkpoint.capturedAt!,
                      options: options.investigation?.chain,
                      backend: createInvestigationBackend({
                        studentId: job.student_id,
                        generation: job.generation_id,
                        capturedAt: job.checkpoint.capturedAt!,
                        evidence: job.checkpoint.evidence!,
                        domain: initial.plan.body.domain!,
                        departmentId: initial.plan.department_id,
                        signalText: job.checkpoint
                          .risk!.signals.map((s) => s.explanation)
                          .join(" "),
                        authorize,
                        prior: () => readSource(actor, job.student_id, "priorInterventions"),
                      }),
                    });
                  });
                  await recordAgentAudit(actor, job, outcome.summary);
                  context = outcome.context;
                  const tools = (outcome.context.evidence as { tools?: ToolEvidence }).tools;
                  if (tools) job.checkpoint.toolEvidence = tools;
                  if (outcome.primed !== undefined && provider)
                    composer = primedComposer(provider, outcome);
                }
                const composed = await compose(context, composer, runNode);
                await recordEgress(actor, job, composed.validation.provenance);
                await recordJudgeAudit(actor, job, composed.validation);
                if (composed.unavailable)
                  throw new AiUnavailableError(
                    "No AI model answered, so no draft was made. Retry the review when a model is available.",
                    unavailableReasons(composed.validation.provenance),
                  );
                await saveCheckpoint(actor, job, "publish", {
                  ...job.checkpoint,
                  composed,
                });
              }
              if (options.stopAfterStage === "publish")
                throw new Error("INJECTED_STOP");
            },
            HumanGate: async () => {
              await ensureReviewRunning(actor, planId);
              if (job.checkpoint.composed?.validation.escalated) {
                await withCoreTransaction(async (client) => {
                  // Serialise with pause (as publishDraft does): a pause that committed
                  // after the check above leaves the job resumable, not terminal.
                  const activePlan = await getPlan(client, actor, planId, true);
                  if (activePlan.paused)
                    throw new ConflictError(
                      "PLAN_PAUSED",
                      "Review paused before escalating to a mentor",
                    );
                  const escalated = await client.query(
                    "UPDATE ch11_jobs SET status='failed',stage='needs_human',escalated_at=now(),failure_diagnosis=$2::jsonb,error_code='REPAIR_BUDGET_EXHAUSTED',lease_until=NULL WHERE id=$1 AND lease_token=$3 AND status='running' RETURNING id",
                    [
                      job.id,
                      JSON.stringify(job.checkpoint.composed!.validation),
                      job.lease_token,
                    ],
                  );
                  if (!escalated.rowCount)
                    throw new ConflictError("LEASE_LOST", "Another executor owns this job");
                  await audit(
                    client,
                    job.generation_id,
                    actor,
                    job.id,
                    "execution.escalated",
                    { stage: job.stage },
                    { diagnosis: job.checkpoint.composed!.validation },
                  );
                });
                return { id, escalated: true };
              }
              await publishDraft(actor, job, initial.plan);
              return { id, completed: true };
            },
          },
          async (run) => {
            if (!job.checkpoint.evidence || !job.checkpoint.evidenceRevision) {
              const snapshot = await collectSnapshot(
                sourceNames.map(
                  (source, i) => () =>
                    run(collectorNodes[i]!, () =>
                      readSource(actor, job.student_id, source),
                    ),
                ),
                options.collectorConcurrency ?? 4,
              );
              Object.assign(job.checkpoint, {
                evidence: Object.fromEntries(
                  sourceNames.map((source, i) => [source, snapshot.results[i]]),
                ) as Evidence,
                evidenceRevision: snapshot.evidenceRevision,
                capturedAt: snapshot.capturedAt,
                sourceTimings: Object.fromEntries(
                  sourceNames.map((source, i) => [source, snapshot.timings[i]]),
                ),
                policy: initial.policy,
              });
            }
          },
          trace,
        )) as { id: string; completed?: boolean; escalated?: boolean };
        trace.HumanGate!.status = result.escalated
          ? "escalated"
          : job.checkpoint.risk!.flagged
            ? "waiting"
            : "completed";
        trace.DashboardPublisher = {
          status: job.checkpoint.risk!.flagged ? "waiting" : "cancelled",
          visits: 0,
          elapsedMs: 0,
        };
        await finalizeGraphCheckpoint(actor, job, trace);
        return result;
      } catch (error) {
        if (error instanceof DataBlocked) {
          job.checkpoint.rejectedEvidence = job.checkpoint.evidence;
          delete job.checkpoint.evidence;
          delete job.checkpoint.evidenceRevision;
        }
        const code =
          error instanceof DataBlocked
            ? "DATA_BLOCKED"
            : error instanceof ConflictError
              ? error.code
              : error instanceof Error && error.message === "INJECTED_STOP"
                ? "INJECTED_STOP"
                : "EXECUTION_FAILED";
        heartbeat.stop();
        const reasons =
          error instanceof DataBlocked || error instanceof AiUnavailableError
            ? error.reasons
            : [];
        // The status change commits on its own; the audit row is best-effort in a
        // second transaction so an audit fault cannot leave the job 'running'.
        await persistThenAudit(
          () =>
            withCoreTransaction(async (client) => {
              const stopped = await client.query(
                "UPDATE ch11_jobs SET status=$2,error_code=$3,escalated_at=CASE WHEN attempts>=3 AND $3 NOT IN ('PLAN_PAUSED','AI_UNAVAILABLE') THEN now() ELSE NULL END,failure_diagnosis=$5::jsonb,checkpoint=$6::jsonb,attempts=CASE WHEN $3 IN ('PLAN_PAUSED','AI_UNAVAILABLE') THEN greatest(0,attempts-1) ELSE attempts END,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$4 AND status='running' RETURNING id",
                [
                  job.id,
                  code === "PLAN_PAUSED"
                    ? "queued"
                    : code === "DATA_BLOCKED"
                      ? "blocked"
                      : "failed",
                  code,
                  job.lease_token,
                  JSON.stringify({ code, attempts: job.attempts, reasons }),
                  JSON.stringify(job.checkpoint),
                ],
              );
              return (stopped.rowCount ?? 0) > 0;
            }),
          () =>
            withCoreTransaction((client) =>
              audit(
                client,
                job.generation_id,
                actor,
                job.id,
                "execution.stopped",
                { stage: job.stage },
                { code, reasons },
              ),
            ),
        );
        return { id, error: code };
      } finally {
        heartbeat.stop();
      }
    },
  );
  const alignment = {
    planHash: initial.plan.plan_hash,
    policyVersion: initial.policy.version,
    domain: initial.plan.body.domain,
    scopedStudentIds: initial.plan.body.studentIds,
    selectedJobIds: results
      .filter((r) => "completed" in r && r.completed)
      .map((r) => r.id),
    rejectedJobIds: results
      .filter((r) => !("completed" in r && r.completed))
      .map((r) => r.id),
    rule: "Merge only completed jobs from this locked plan, with the same approved policy and scoped student list; failures remain separately visible.",
  };
  const report = {
    planId,
    alignment,
    elapsedMs: Math.round(performance.now() - start),
    concurrency: options.concurrency ?? initial.plan.body.budget.concurrency,
    results,
  };
  await withCoreTransaction((client) =>
    audit(
      client,
      initial.plan.generation_id,
      actor,
      planId,
      "execution.merged",
      {
        studentIds: initial.plan.body.studentIds,
        planHash: initial.plan.plan_hash,
      },
      report,
    ),
  );
  return report;
}

/** The case lock serializes final checkpointing with exact-artifact decisions. */
export async function finalizeGraphCheckpoint(
  actor: ActorContext,
  job: Job,
  trace: NodeTrace,
) {
  return withCoreTransaction(async (client) => {
    const current = (
      await client.query(
        "SELECT support_case_id,lease_token FROM ch11_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0];
    if (current.lease_token !== job.lease_token)
      throw new ConflictError("LEASE_LOST", "Another executor owns this job");
    // Match decision lock order: case, then job. A fresh statement after the
    // case lock reads any already-committed decision trace.
    const decision = current.support_case_id
      ? (
          await client.query(
            "SELECT status FROM support_cases WHERE id=$1 FOR UPDATE",
            [current.support_case_id],
          )
        ).rows[0]
      : null;
    if (decision && ["approved", "rejected"].includes(decision.status)) {
      const saved = (
        await client.query("SELECT checkpoint FROM ch11_jobs WHERE id=$1", [
          job.id,
        ])
      ).rows[0].checkpoint;
      Object.assign(trace, {
        HumanGate: saved.nodeTrace.HumanGate,
        DashboardPublisher: saved.nodeTrace.DashboardPublisher,
      });
    }
    const saved = await client.query(
      "UPDATE ch11_jobs SET checkpoint=$2::jsonb WHERE id=$1 AND lease_token=$3 RETURNING id",
      [job.id, JSON.stringify(job.checkpoint), job.lease_token],
    );
    if (saved.rowCount)
      await audit(
        client,
        job.generation_id,
        actor,
        job.id,
        "graph.checkpoint",
        { graphVersion: reviewGraph.version },
        { nodeTrace: trace },
      );
  });
}

/** Smallest group whose average score a non-mentor role may see. */
const MIN_GROUP = 3;
function scopeTrend<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const band of ["low", "medium", "high"])
    if (Number(out[`count_${band}`] ?? 0) < MIN_GROUP) out[`average_${band}`] = null;
  return out as T;
}

type Loose = Record<string, unknown>;
const looseObject = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
const pickKeys = (from: Loose, keys: string[]): Loose =>
  Object.fromEntries(keys.filter((key) => from[key] !== undefined).map((key) => [key, from[key]]));

/** The judge verdict without its reasons: they name draft sentences and carry
 * student figures (judge.ts), so they stay with the assigned mentor. */
function safeJudge(raw: unknown): Loose | null {
  const judge = looseObject(raw);
  if (!judge) return null;
  const previous = safeJudge(judge.previous);
  return {
    ...pickKeys(judge, ["status", "round", "threshold", "scores", "mean", "min", "low", "passed", "provider", "model", "unavailableReason", "repair", "injected"]),
    ...(previous ? { previous } : {}),
  };
}

const countOf = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/** An escalated job stores its whole validation report as the failure
 * diagnosis; other stops store a code, the attempt count and plain reasons.
 * Those reasons can name courses and figures (a blocked data check, for
 * example), so other roles learn how many there were, never the text. */
function safeFailureDiagnosis(raw: unknown): Loose | null {
  const diagnosis = looseObject(raw);
  if (!diagnosis) return null;
  return typeof diagnosis.code === "string"
    ? { ...pickKeys(diagnosis, ["code", "attempts", "repairCount"]), reasonCount: countOf(diagnosis.reasons) }
    : safeValidation(diagnosis);
}

/**
 * What the department head and the AI-activity workspace receive of a draft's
 * validation report (review R-01): the review mechanics only. Judge reasons,
 * model attempts, failures and diagnoses hold draft text and student figures,
 * so only the assigned mentor (role faculty) receives the full report. Tool
 * calls keep their name and status, never their arguments.
 */
export function safeValidation(raw: unknown): Loose | null {
  const validation = looseObject(raw);
  if (!validation) return null;
  const provenance = looseObject(validation.provenance);
  const agent = looseObject(provenance?.agent);
  const checks = looseObject(validation.checks);
  const judge = safeJudge(validation.judge);
  const listOf = (value: unknown) => (Array.isArray(value) ? value.map(looseObject).filter((item): item is Loose => !!item) : []);
  return {
    ...pickKeys(validation, ["valid", "escalated", "unavailable", "packetSchema", "fallback"]),
    repairCount: Array.isArray(validation.repairs) ? validation.repairs.length : 0,
    ...(checks
      ? { checks: Object.fromEntries(Object.entries(checks).filter(([, value]) => typeof value === "boolean" || value === null)) }
      : {}),
    ...(judge ? { judge } : {}),
    ...(provenance
      ? {
          provenance: {
            ...pickKeys(provenance, ["provider", "model", "tokens", "calls", "specialist", "repairs"]),
            fallbacks: listOf(provenance.fallbacks).map((item) => pickKeys(item, ["provider", "model", "reason"])),
            egress: listOf(provenance.egress).map((item) =>
              pickKeys(item, ["provider", "model", "payloadHash", "fields", "bytes", "outcome", "category", "reached"]),
            ),
            ...(judge ? { judge } : {}),
            ...(provenance.injected ? { injected: listOf(provenance.injected).map((item) => pickKeys(item, ["kind"])) } : {}),
            agent: agent
              ? {
                  ...pickKeys(agent, ["role", "mode", "turns", "modelCalls", "budget", "provider", "model", "tokens", "evidenceValues"]),
                  toolCalls: listOf(agent.toolCalls).map((call) => pickKeys(call, ["seq", "turn", "tool", "status", "code"])),
                }
              : null,
          },
        }
      : {}),
  };
}

/** Whether the risk check flagged the student, without the score (review R-09). A
 * review that stopped before the risk check (blocked, failed, handed over early)
 * has no risk analysis, so it is not flagged. */
export function riskFlagged(risk: unknown): boolean {
  return looseObject(risk)?.flagged === true;
}

/** A review job as the department head and AI activity receive it: the review
 * mechanics and whether the student was flagged, never the score, band or signals
 * (E2E log #8) and never draft-derived text or stop reasons (review R-01): the
 * reasons stay with the assigned mentor, other roles get their count. */
type SafeJobFields = {
  risk: null;
  flagged: boolean;
  validation: Loose | null;
  failure_diagnosis: Loose | null;
  failure_reasons: never[];
  failure_reason_count: number;
};
export function safeJobRow<T extends Loose>(row: T): Omit<T, keyof SafeJobFields> & SafeJobFields {
  return {
    ...row,
    risk: null,
    flagged: riskFlagged(row.risk),
    validation: safeValidation(row.validation),
    failure_diagnosis: safeFailureDiagnosis(row.failure_diagnosis),
    failure_reasons: [],
    failure_reason_count: countOf(row.failure_reasons),
  };
}

export async function overview(actor: ActorContext) {
  requireRole(actor, "faculty", "governance", "hod");
  return withCoreTransaction(async (client) => {
    const generation = await getCurrentGeneration(client);
    const department = actor.role === "governance" ? null : actor.departmentId;
    const mentor = actor.role === "faculty" ? actor.personId : null;
    // Risk analyses, review cycles and AI-activity figures are read from the current
    // data generation only. Reviews whose evidence was captured before the current
    // generation was applied are history: kept, reachable by export, never counted
    // next to today's figures (data-refresh/generation.ts).
    const clock = await loadGenerationClock(client);
    const currentJob = currentEvidenceSql(jobEvidenceCapturedSql("j.checkpoint"), "$4");
    const students = await client.query(
      `SELECT s.id,s.department_id,s.register_number,p.display_name,m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name FROM student_profiles s JOIN people p ON p.id=s.person_id LEFT JOIN mentor_assignments m ON m.student_id=s.id LEFT JOIN people mp ON mp.id=m.faculty_person_id
      WHERE s.generation_id=$1 AND ($2::uuid IS NULL OR s.department_id=$2) AND ($3::uuid IS NULL OR EXISTS(
      SELECT 1 FROM mentor_assignments m WHERE m.generation_id=s.generation_id AND m.student_id=s.id AND m.faculty_person_id=$3)) ORDER BY s.register_number`,
      [generation, department, mentor],
    );
    const policies = await client.query(
      "SELECT ch11_policies.*, policy || scoring AS policy FROM ch11_policies WHERE generation_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND ($3::uuid IS NULL OR faculty_person_id=$3) ORDER BY created_at DESC",
      [generation, department, mentor],
    );
    const plans = await client.query(
      "SELECT * FROM ch11_plans p WHERE generation_id=$1 AND ($2::uuid IS NULL OR department_id=$2) AND ($3::uuid IS NULL OR ((created_by=$3 OR body->>'policyId' IN (SELECT id::text FROM ch11_policies WHERE faculty_person_id=$3)) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p.body->'studentIds','[]'::jsonb)) selected(student_id) WHERE NOT EXISTS (SELECT 1 FROM mentor_assignments m WHERE m.generation_id=$1 AND m.student_id::text=selected.student_id AND m.faculty_person_id=$3)))) AND (p.status<>'locked' OR EXISTS(SELECT 1 FROM ch11_jobs j WHERE j.plan_id=p.id AND " + currentJob + ")) ORDER BY created_at DESC",
      [generation, department, mentor, clock.since],
    );
    // A job's status is its case status, which stays "approved" after the mentor
    // withdraws the plan; intervention_status tells the screens (review R-17).
    const jobs = await client.query(
      "SELECT j.id,(SELECT ar.id FROM agent_runs ar WHERE ar.support_case_id=j.support_case_id AND ar.generation_id=j.generation_id ORDER BY ar.completed_at DESC LIMIT 1) AS run_id,(SELECT ar.model_id FROM agent_runs ar WHERE ar.support_case_id=j.support_case_id AND ar.generation_id=j.generation_id ORDER BY ar.completed_at DESC LIMIT 1) AS model_id,j.plan_id,j.student_id,j.created_at,j.attempts,j.faculty_person_id,COALESCE((SELECT e.detail->'output'->'reasons' FROM ch11_events e WHERE e.subject_id=j.id AND e.event_type='execution.stopped' ORDER BY e.created_at DESC LIMIT 1),'[]') AS failure_reasons,CASE WHEN j.escalated_at IS NOT NULL THEN 'needs_human' WHEN j.status='failed' AND j.error_code='AI_UNAVAILABLE' THEN 'ai_unavailable' ELSE COALESCE(c.status,j.status) END AS status,(SELECT i.status FROM support_plans sp JOIN ch11_interventions i ON i.support_plan_id=sp.id WHERE sp.support_case_id=j.support_case_id ORDER BY sp.created_at DESC LIMIT 1) AS intervention_status,j.failure_diagnosis,j.stage,j.error_code,j.support_case_id,j.updated_at,p.paused AS plan_paused,j.checkpoint->'nodeTrace' AS node_trace,j.checkpoint->'retrieval' AS retrieval,j.checkpoint->'sourceTimings' AS source_timings,j.checkpoint->>'evidenceRevision' AS evidence_revision,j.checkpoint->'risk' AS risk,j.checkpoint->'composed'->'validation' AS validation,j.checkpoint->'composed'->>'mode' AS mode FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id LEFT JOIN support_cases c ON c.id=j.support_case_id WHERE j.generation_id=$1 AND ($2::uuid IS NULL OR p.department_id=$2) AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=j.student_id AND m.faculty_person_id=$3)) AND " + currentJob + " ORDER BY j.created_at DESC",
      [generation, department, mentor, clock.since],
    );
    const trends = await client.query(
      `SELECT p.id AS cycle_id,
      to_char(p.created_at,'YYYY-MM-DD') || ' / ' || left(p.id::text,8) AS day,
      count(*) FILTER (WHERE j.checkpoint ? 'risk')::int AS reviewed,
      count(*) FILTER (WHERE j.checkpoint->'risk'->>'flagged'='true')::int AS flagged,
      count(*) FILTER (WHERE j.status='blocked')::int AS blocked,
      count(*) FILTER (WHERE COALESCE(c.status,j.status)='awaiting_faculty')::int AS awaiting_approval,
      count(*) FILTER (WHERE d.decision='approved')::int AS approved,
      count(*) FILTER (WHERE i.status='completed')::int AS completed,
      count(*) FILTER (WHERE i.status='withdrawn')::int AS withdrawn,
      avg((j.checkpoint->'risk'->>'score')::numeric) FILTER (WHERE j.checkpoint->'risk'->>'band'='low')::float AS average_low,
      avg((j.checkpoint->'risk'->>'score')::numeric) FILTER (WHERE j.checkpoint->'risk'->>'band'='medium')::float AS average_medium,
      avg((j.checkpoint->'risk'->>'score')::numeric) FILTER (WHERE j.checkpoint->'risk'->>'band'='high')::float AS average_high,
      count(*) FILTER (WHERE j.checkpoint->'risk'->>'band'='low')::int AS count_low,
      count(*) FILTER (WHERE j.checkpoint->'risk'->>'band'='medium')::int AS count_medium,
      count(*) FILTER (WHERE j.checkpoint->'risk'->>'band'='high')::int AS count_high
      FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id
      LEFT JOIN support_cases c ON c.id=j.support_case_id
      LEFT JOIN faculty_decisions d ON d.support_case_id=c.id
      LEFT JOIN support_plans sp ON sp.support_case_id=c.id
      LEFT JOIN ch11_interventions i ON i.support_plan_id=sp.id
      WHERE j.generation_id=$1 AND ($2::uuid IS NULL OR p.department_id=$2)
      AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.generation_id=j.generation_id AND m.student_id=j.student_id AND m.faculty_person_id=$3))
      AND ${currentJob}
      GROUP BY p.id ORDER BY p.created_at`,
      [generation, department, mentor, clock.since],
    );
    const earlier = (
      await client.query<{ jobs: number; cycles: number }>(
        `SELECT count(*)::int AS jobs,count(DISTINCT j.plan_id)::int AS cycles FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id
        WHERE j.generation_id=$1 AND ($2::uuid IS NULL OR p.department_id=$2)
        AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.generation_id=j.generation_id AND m.student_id=j.student_id AND m.faculty_person_id=$3))
        AND NOT ${currentJob}`,
        [generation, department, mentor, clock.since],
      )
    ).rows[0]!;
    const metricFacts = await client.query(
      `SELECT j.id,j.plan_id,d.decision,d.decided_at,approved.recommendation AS approved_packet,approved.artifact_version,first.recommendation AS first_packet,first.created_at AS first_created FROM ch11_jobs j LEFT JOIN faculty_decisions d ON d.support_case_id=j.support_case_id LEFT JOIN agent_artifacts approved ON approved.id=d.agent_artifact_id LEFT JOIN LATERAL (SELECT a.recommendation,a.created_at FROM agent_artifacts a JOIN agent_runs r ON r.id=a.agent_run_id WHERE r.support_case_id=j.support_case_id ORDER BY a.created_at,a.artifact_version LIMIT 1) first ON true WHERE j.generation_id=$1 AND j.id=ANY($2::uuid[])`,
      [generation, jobs.rows.map((row) => row.id)],
    );
    const facts = new Map(metricFacts.rows.map((row) => [row.id, row]));
    const metrics = evaluationMetrics(
      jobs.rows.map((row) => ({ ...row, ...facts.get(row.id) })),
    );
    // Individual risk scores belong to the student's assigned mentor (E2E log #8).
    // Other roles get the review mechanics and department aggregates only: no
    // per-student score, band or signals, and no band average over a handful of students.
    const assignedMentor = actor.role === "faculty";
    return {
      graph: reviewGraph,
      metrics,
      trends: assignedMentor
        ? trends.rows
        : trends.rows.map((row) => scopeTrend(row)),
      riskView: assignedMentor ? compositeRiskView(students.rows, jobs.rows) : [],
      students: students.rows,
      policies: policies.rows,
      plans: plans.rows,
      jobs: assignedMentor
        ? jobs.rows.map((row) => ({ ...row, flagged: riskFlagged(row.risk) }))
        : jobs.rows.map((row) => safeJobRow(row)),
      demoPolicy,
      modelConfigured: !!configuredComposer(),
      synthetic: process.env.CORE_IDENTITY_REALM !== "institutional",
      dataGeneration: {
        current: clock.current,
        since: clock.since,
        earlierReviews: earlier.jobs,
        earlierCycles: earlier.cycles,
      },
    };
  });
}

export async function exportPlan(actor: ActorContext, id: string) {
  return withCoreTransaction(async (client) => {
    const plan = await getPlan(client, actor, id);
    const jobs = await client.query(
      "SELECT * FROM ch11_jobs WHERE plan_id=$1 AND generation_id=$2 ORDER BY student_id",
      [id, plan.generation_id],
    );
    const events = await client.query(
      "SELECT * FROM ch11_events WHERE generation_id=$1 AND (subject_id=$2 OR subject_id IN (SELECT id FROM ch11_jobs WHERE plan_id=$2)) ORDER BY created_at,id",
      [plan.generation_id, id],
    );
    // Only the assigned mentor receives the evidence and risk figures. The
    // department head and AI-activity roles get the process record: states,
    // node trace, timings and event hashes, without scores or evidence values.
    const assignedMentor = actor.role === "faculty";
    return {
      schemaVersion: 1,
      synthetic: process.env.CORE_IDENTITY_REALM !== "institutional",
      plan,
      jobs: assignedMentor
        ? jobs.rows
        : jobs.rows.map((job: { checkpoint?: Checkpoint }) => ({
            ...job,
            checkpoint: {
              nodeTrace: job.checkpoint?.nodeTrace,
              sourceTimings: job.checkpoint?.sourceTimings,
            },
          })),
      events: assignedMentor
        ? events.rows
        : events.rows.map((event: Record<string, unknown>) => ({ ...event, detail: { redacted: true } })),
      exportedAt: new Date().toISOString(),
    };
  });
}

async function ensureReviewRunning(actor: ActorContext, id: string) {
  await withCoreTransaction(async (client) => {
    const plan = await getPlan(client, actor, id);
    if (plan.paused)
      throw new ConflictError(
        "PLAN_PAUSED",
        "Review paused before the next stage",
      );
  });
}
export async function setReviewPaused(
  actor: ActorContext,
  id: string,
  raw: unknown,
) {
  requireRole(actor, "faculty");
  const input = z
    .object({
      paused: z.boolean(),
      expectedRevision: z.number().int().nonnegative(),
      reason: z.string().trim().min(5).max(600),
    })
    .strict()
    .parse(raw);
  return withCoreTransaction(async (client) => {
    const plan = await getPlan(client, actor, id, true);
    if (plan.revision !== input.expectedRevision)
      throw new ConflictError(
        "STALE_VERSION",
        "Reload this review before changing its status",
      );
    await client.query(
      "UPDATE ch11_plans SET paused=$2,revision=revision+1 WHERE id=$1",
      [id, input.paused],
    );
    await audit(
      client,
      plan.generation_id,
      actor,
      id,
      input.paused ? "review.paused" : "review.resumed",
      { paused: plan.paused, reason: input.reason },
      { paused: input.paused },
    );
    return { id, paused: input.paused, revision: plan.revision + 1 };
  });
}
