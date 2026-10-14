import { createHash } from "node:crypto";
import { z } from "zod";
import { validationRoute, type RunNode } from "./graph";
import { buildAliases, restoreAliases, type AliasMap, type EgressAudit, type GuardRoster } from "./egress";
import {
  isPacketV2,
  packetV2Schema,
  templateV2,
  validatePacketV2,
  type PacketV2,
} from "./packet-v2";
export { isPacketV2, packetV2Schema, type PacketV2 };
import { actions, domainNames } from "./catalogue";
import { routeSpecialist, specialistRegistry } from "./specialists";
export { actions, domainNames, routeSpecialist, specialistRegistry };

export const sourceNames = [
  "academic",
  "lms",
  "internship",
  "placement",
] as const;
export type SourceName = (typeof sourceNames)[number];
export const policySchema = z
  .object({
    version: z.string().min(3).max(80),
    attendanceMinimum: z.number().min(0).max(100),
    markMinimum: z.number().min(0).max(100),
    inactivityMaximum: z.number().int().min(1).max(90),
    mediumScore: z.number().min(1).max(99),
    highScore: z.number().min(2).max(100),
    freshnessDays: z.number().int().min(1).max(365),
    attendanceWeight: z.number().int().min(0).max(100).default(20),
    markWeight: z.number().int().min(0).max(100).default(20),
    inactivityWeight: z.number().int().min(0).max(100).default(20),
    overdueWeight: z.number().int().min(0).max(100).default(10),
    internshipWeight: z.number().int().min(0).max(100).default(15),
    placementWeight: z.number().int().min(0).max(100).default(15),
    overdueMinimum: z.number().int().min(1).max(100).default(1),
    internshipMinimum: z.number().int().min(1).max(100).default(1),
    placementMinimum: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .refine(
    (p) => p.highScore > p.mediumScore,
    "High threshold must exceed medium threshold",
  );
export type Policy = z.infer<typeof policySchema>;
export const demoPolicy: Policy = {
  version: "CH11-DEMO-1",
  attendanceMinimum: 75,
  markMinimum: 60,
  inactivityMaximum: 7,
  mediumScore: 20,
  highScore: 50,
  freshnessDays: 30,
  attendanceWeight: 20,
  markWeight: 20,
  inactivityWeight: 20,
  overdueWeight: 10,
  internshipWeight: 15,
  placementWeight: 15,
  overdueMinimum: 1,
  internshipMinimum: 1,
  placementMinimum: 1,
};

/** Student criteria the planner resolved server-side (stored for display; the
 * resolved ids, not the criteria, are what the plan covers). */
export const storedFilterSchema = z
  .object({
    allMine: z.boolean().optional(),
    semesterMin: z.number().int().min(1).max(12).optional(),
    semesterMax: z.number().int().min(1).max(12).optional(),
    attendanceBelowPct: z.number().min(0).max(100).optional(),
    markBelowPct: z.number().min(0).max(100).optional(),
  })
  .strict();
export const agentTraceSchema = z
  .object({
    role: z.enum(["investigator", "planner"]),
    mode: z.enum(["tools", "standard-evidence"]),
    turns: z.number().int().min(0).max(10),
    modelCalls: z.number().int().min(0).max(10),
    budget: z
      .object({ maxTurns: z.number().int(), maxToolCalls: z.number().int() })
      .strict(),
    toolCalls: z
      .array(
        z
          .object({
            seq: z.number().int(),
            turn: z.number().int(),
            tool: z.string().max(64),
            args: z.unknown(),
            status: z.enum(["ok", "refused", "error"]),
            code: z.string().max(64).optional(),
            resultHash: z.string().max(64).optional(),
            resultBytes: z.number().int().optional(),
          })
          .strict(),
      )
      .max(16),
    provider: z.string().max(40).nullable(),
    model: z.string().max(80).nullable(),
    tokens: z.number().nullable(),
    latencyMs: z.number(),
    fallbackReason: z.string().max(300).nullable(),
    skippedReason: z.string().max(300).optional(),
    evidenceValues: z.number().int(),
    fallbacks: z
      .array(
        z.object({
          provider: z.string(),
          model: z.string(),
          reason: z.string().max(300),
        }),
      )
      .max(12),
    /** where the clarifying questions came from */
    questionSource: z.enum(["model", "rules", "model+rules"]).optional(),
  })
  .strict();
export const planInputSchema = z
  .object({
    request: z.string().trim().min(3).max(2000),
    studentIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    domain: z.enum(domainNames).optional(),
    policyId: z.string().uuid().optional(),
    feedback: z.string().trim().max(1000).default(""),
    mode: z.enum(["deterministic", "model"]).default("deterministic"),
    /** server-set by the planner agent; stripped from every external save */
    filter: storedFilterSchema.optional(),
    agentQuestions: z.array(z.string().min(5).max(240)).max(5).optional(),
    agentSteps: z.array(z.string().min(5).max(200)).max(6).optional(),
    agent: agentTraceSchema.optional(),
  })
  .strict();
export type PlanInput = z.infer<typeof planInputSchema>;
/** Explicit feedback directives revise typed constraints; scope is rechecked by
 * savePlan. Other notes inform retrieval and steps without inventing answers. */
export function applyPlanningFeedback(input: PlanInput): PlanInput {
  const focus = input.feedback
    .match(
      /(?:^|\n)focus:\s*(academic|attendance|wellbeing-referral)\s*(?:$|\n)/i,
    )?.[1]
    ?.toLowerCase();
  const students = input.feedback.match(/(?:^|\n)students:\s*([^\n]+)/i)?.[1];
  const policy = input.feedback
    .match(/(?:^|\n)policy:\s*([^\n]+)/i)?.[1]
    ?.trim();
  return planInputSchema.parse({
    ...input,
    ...(focus ? { domain: focus } : {}),
    ...(students
      ? { studentIds: students.split(",").map((id) => id.trim()) }
      : {}),
    ...(policy ? { policyId: policy } : {}),
  });
}
/** Agent-only fields never arrive from a browser or an RPC body. */
export function withoutAgentFields(input: PlanInput): PlanInput {
  const clean = { ...input };
  delete clean.filter;
  delete clean.agentQuestions;
  delete clean.agentSteps;
  delete clean.agent;
  return clean;
}
export function planSkill(raw: PlanInput) {
  const input = applyPlanningFeedback(raw);
  const missing: string[] = [];
  if (!input.studentIds?.length)
    missing.push("Which students should this review cover?");
  if (!input.domain)
    missing.push(
      "Should this review focus on academics, attendance, or a wellbeing referral?",
    );
  if (!input.policyId)
    missing.push(
      "Which mentor-approved threshold policy should this review use?",
    );
  // The planner's request-specific questions come first. The rule questions for
  // unresolved fields fill in when the model asked fewer than two, so a plan
  // with a missing field can never look ready.
  const asked = input.agentQuestions ?? [];
  const questions = asked.length
    ? [...asked, ...(asked.length < 2 ? missing : [])]
    : missing;
  return {
    ...input,
    questions,
    ready: questions.length === 0,
    steps: [
      `Collect four sources concurrently for ${input.studentIds?.length ?? "unconfirmed"} scoped students`,
      "Check freshness, completeness and privacy scope",
      `Compute faculty-approved policy ${input.policyId ?? "(awaiting selection)"}`,
      `Retrieve references tagged ${input.domain ?? "(awaiting focus)"}${input.feedback ? "; apply the saved planning feedback" : ""}`,
      `Draft ${input.domain ?? "focused"} support options and validate four acceptance checks`,
      "Wait for the assigned mentor's exact-artifact approval",
      "Publish and track approved interventions",
    ],
    budget: {
      maxStudents: 50,
      concurrency: 4,
      maxRepairs: 2,
      modelTimeoutMs: 45000,
    },
  };
}

export const sourceSchema = z
  .object({
    source: z.enum(sourceNames),
    studentId: z.string().uuid(),
    recordId: z.string().min(1),
    observedAt: z.string().datetime(),
    semester: z.string().min(1),
    state: z.enum(["present", "missing", "not_applicable"]),
    synthetic: z.boolean(),
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;
export type Evidence = Record<SourceName, Source>;
export type Signal = {
  code: string;
  source: SourceName;
  path: string;
  value: number;
  threshold: number;
  points: number;
  explanation: string;
};
export type Risk = {
  score: number;
  band: "low" | "medium" | "high";
  flagged: boolean;
  signals: Signal[];
  policyVersion: string;
  reviewRequired: true;
};
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export class DataBlocked extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
  }
}
export function validateEvidence(
  evidence: Evidence,
  studentId: string,
  policy: Policy,
  at: string,
  semester: string,
) {
  const failures: string[] = [];
  for (const name of sourceNames) {
    const parsed = sourceSchema.safeParse(evidence[name]);
    if (!parsed.success) {
      failures.push(`${name}: invalid source contract`);
      continue;
    }
    const record = parsed.data;
    if (
      record.studentId !== studentId ||
      record.source !== name ||
      record.semester !== semester
    )
      failures.push(`${name}: scope mismatch`);
    const age = Date.parse(at) - Date.parse(record.observedAt);
    if (age < -60000 || age > policy.freshnessDays * 86400000)
      failures.push(`${name}: stale or future evidence`);
    if (
      record.state === "missing" ||
      ((name === "academic" || name === "lms") && record.state !== "present")
    )
      failures.push(`${name}: required evidence missing`);
    if (record.state === "present") {
      const keys =
        name === "academic"
          ? ["attendancePct", "markPct"]
          : name === "lms"
            ? ["inactivityDays", "overdueAssignments"]
            : name === "internship"
              ? ["missedMilestones"]
              : ["missedActivities"];
      for (const key of keys) {
        const value = record.values[key];
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          (key.endsWith("Pct") && value > 100)
        )
          failures.push(`${name}.${key}: invalid or absent number`);
      }
    }
  }
  if (failures.length) throw new DataBlocked(failures);
}
export function riskAnalysis(evidence: Evidence, policy: Policy): Risk {
  const signals: Signal[] = [];
  const check = (
    source: SourceName,
    key: string,
    threshold: number,
    below: boolean,
    points: number,
    code: string,
  ) => {
    if (evidence[source].state !== "present") return;
    const value = evidence[source].values[key] as number;
    if (below ? value < threshold : value >= threshold)
      signals.push({
        code,
        source,
        path: `evidence.${source}.values.${key}`,
        value,
        threshold,
        points,
        explanation: `${key} is ${value}; policy threshold is ${below ? "below" : "at least"} ${threshold}.`,
      });
  };
  check(
    "academic",
    "attendancePct",
    policy.attendanceMinimum,
    true,
    policy.attendanceWeight,
    "ATTENDANCE_LOW",
  );
  check(
    "academic",
    "markPct",
    policy.markMinimum,
    true,
    policy.markWeight,
    "MARK_LOW",
  );
  check(
    "lms",
    "inactivityDays",
    policy.inactivityMaximum,
    false,
    policy.inactivityWeight,
    "LMS_INACTIVE",
  );
  check(
    "lms",
    "overdueAssignments",
    policy.overdueMinimum,
    false,
    policy.overdueWeight,
    "ASSIGNMENT_OVERDUE",
  );
  check(
    "internship",
    "missedMilestones",
    policy.internshipMinimum,
    false,
    policy.internshipWeight,
    "INTERNSHIP_MILESTONE",
  );
  check(
    "placement",
    "missedActivities",
    policy.placementMinimum,
    false,
    policy.placementWeight,
    "PLACEMENT_ACTIVITY",
  );
  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.points, 0),
  );
  return {
    score,
    band:
      score >= policy.highScore
        ? "high"
        : score >= policy.mediumScore
          ? "medium"
          : "low",
    flagged: score >= policy.mediumScore,
    signals,
    policyVersion: policy.version,
    reviewRequired: true,
  };
}

// A reproducible lexical embedding, not a pretrained semantic model. Its identity is
// recorded with retrieval evidence so similarity is never misrepresented.
export function embed(text: string): number[] {
  const vector = Array<number>(128).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash("sha256").update(token).digest();
    vector[h[0]! % 128]! += h[1]! % 2 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}
export type Reference = {
  id: string;
  text: string;
  tags: string[];
  departmentId: string | null;
  studentId?: string;
  actionCodes?: string[];
  embedding?: number[];
};
export function retrieve(
  query: string,
  tags: string[],
  references: Reference[],
  departmentId: string,
  studentId: string,
) {
  const q = embed(query);
  return references
    .filter(
      (r) =>
        (r.departmentId === null || r.departmentId === departmentId) &&
        (!r.studentId || r.studentId === studentId) &&
        tags.some((t) => r.tags.includes(t)),
    )
    .map((r) => ({
      id: r.id,
      text: r.text,
      tags: r.tags,
      actionCodes: r.actionCodes ?? [],
      similarity: q.reduce(
        (n, x, i) => n + x * (r.embedding ?? embed(r.text))[i]!,
        0,
      ),
      embeddingModel: "sha256-lexical-128-v1",
    }))
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
    .slice(0, 5);
}

export const packetSchema = z
  .object({
    summary: z.string().min(12).max(600),
    actions: z
      .array(
        z
          .object({
            code: z.enum(
              Object.keys(actions) as [
                keyof typeof actions,
                ...Array<keyof typeof actions>,
              ],
            ),
            label: z.string().min(8).max(180),
            owner: z.enum(["assigned_faculty", "student"]),
            dueInDays: z.number().int().min(1).max(14),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    citations: z
      .array(
        z
          .object({
            evidencePath: z.string(),
            statement: z.string().min(4).max(180),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    prohibited: z.array(z.string()).max(0),
  })
  .strict();
export type Packet = z.infer<typeof packetSchema>;
export const specialists = specialistRegistry;
export function formatSkill(
  risk: Risk,
  domain: (typeof domainNames)[number],
): Packet {
  const codes = specialists[domain].codes;
  const relevant: Array<keyof typeof actions> =
    domain === "attendance"
      ? ["attendance-review"]
      : domain === "wellbeing-referral"
        ? ["wellbeing-referral"]
        : risk.signals.map((s) =>
            s.source === "lms"
              ? "lms-catch-up"
              : s.source === "internship"
                ? "internship-review"
                : s.source === "placement"
                  ? "placement-review"
                  : "student-study-plan",
          );
  return {
    summary: `Mentor review requested: ${risk.signals.map((s) => s.code.toLowerCase().replaceAll("_", " ")).join(", ") || "routine evidence review"}.`,
    actions: [
      ...new Set<keyof typeof actions>(["faculty-check-in", ...relevant]),
    ]
      .filter((c) => codes.includes(c))
      .slice(0, 4)
      .map((code) => ({
        code,
        label: actions[code],
        owner: "assigned_faculty",
        dueInDays: 7,
      })),
    citations: risk.signals.length
      ? risk.signals.map((s) => ({
          evidencePath: s.path,
          statement: s.explanation,
        }))
      : [
          {
            evidencePath: "evidence.academic.values.attendancePct",
            statement: "The academic record is available for routine review.",
          },
        ],
    prohibited: [],
  };
}
export type Diagnosis = {
  field:
    | "summary"
    | "actions"
    | "citations"
    | "prohibited"
    | "rationale"
    | "schema"
    | "specialist";
  code: string;
};
/** packet-v2 template: the labelled deterministic fallback for v2 drafts. */
export function formatSkillV2(
  risk: Risk,
  domain: (typeof domainNames)[number],
  evidence: Evidence,
): PacketV2 {
  // The coordinator routes the case to one specialist pack by its signals.
  const specialist = routeSpecialist(risk.signals, domain);
  return templateV2(
    formatSkill(risk, specialist),
    risk,
    evidence,
    specialist,
    specialists[specialist].evidenceView,
  );
}
export const anyPacketSchema = z.union([packetSchema, packetV2Schema]);
export type AnyPacket = Packet | PacketV2;
export type CheckOptions = {
  aliases?: AliasMap;
  roster?: GuardRoster;
  policy?: Policy;
  specialist?: (typeof domainNames)[number];
  /** expected packet version; inferred from the candidate when omitted */
  version?: 1 | 2;
};
/** Dispatch: v1 keeps its exact-string rules; v2 uses claim-level checks. */
export function validateAnyPacket(
  candidate: unknown,
  evidence: Evidence,
  risk: Risk,
  domain: (typeof domainNames)[number],
  o: CheckOptions = {},
): { valid: boolean; failures: Diagnosis[] } {
  const v2 = o.version ? o.version === 2 : isPacketV2(candidate);
  if (!v2) return validatePacket(candidate, evidence, risk, domain);
  const specialist = o.specialist ?? routeSpecialist(risk.signals, domain);
  const pack = specialists[specialist];
  return validatePacketV2(candidate, evidence, risk, {
    codes: pack.codes,
    specialist,
    language: pack.language,
    scope:
      pack.evidenceView === "triggering"
        ? risk.signals.map((s) => s.path)
        : undefined,
    canonical: new Map(
      formatSkill(risk, domain).citations.map((c) => [
        c.evidencePath,
        c.statement,
      ]),
    ),
    aliases: o.aliases,
    roster: o.roster,
    policy: o.policy,
  });
}
export function validatePacket(
  candidate: unknown,
  evidence: Evidence,
  risk: Risk,
  domain: (typeof domainNames)[number],
): { valid: boolean; failures: Diagnosis[] } {
  const parsed = packetSchema.safeParse(candidate);
  if (
    !parsed.success &&
    (typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate))
  )
    return {
      valid: false,
      failures: (
        ["summary", "actions", "citations", "prohibited"] as const
      ).map((field) => ({ field, code: "SCHEMA_INVALID" })),
    };
  if (!parsed.success)
    return {
      valid: false,
      failures: parsed.error.issues.map((i) => ({
        field: (["summary", "actions", "citations", "prohibited"].includes(
          String(i.path[0]),
        )
          ? i.path[0]
          : "summary") as Diagnosis["field"],
        code: "SCHEMA_INVALID",
      })),
    };
  const p = parsed.data;
  const failures: Diagnosis[] = [];
  const unsafe =
    /diagnos|depress|suicid|automatically contact|email the parent|send.*message|change.*mark|guarantee|will fail|punish|expel/i;
  if (unsafe.test(p.summary))
    failures.push({
      field: "summary",
      code: "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS",
    });
  if (
    p.actions.some(
      (a) =>
        !specialists[domain].codes.includes(a.code) ||
        a.label !== actions[a.code] ||
        a.owner !== "assigned_faculty",
    )
  )
    failures.push({ field: "actions", code: "CATALOGUE_OR_DOMAIN_MISMATCH" });
  const canonicalClaims = new Map(
    formatSkill(risk, domain).citations.map((c) => [
      c.evidencePath,
      c.statement,
    ]),
  );
  for (const c of p.citations) {
    const parts = c.evidencePath.split(".");
    const source = parts[1] as SourceName;
    if (
      parts.length !== 4 ||
      parts[0] !== "evidence" ||
      parts[2] !== "values" ||
      !sourceNames.includes(source) ||
      evidence[source]?.values[parts[3]!] === undefined ||
      canonicalClaims.get(c.evidencePath) !== c.statement
    )
      failures.push({ field: "citations", code: "UNSUPPORTED_CITATION" });
  }
  if (
    risk.signals.some(
      (s) => !p.citations.some((c) => c.evidencePath === s.path),
    )
  )
    failures.push({ field: "citations", code: "MISSING_TRIGGER_COVERAGE" });
  // A closed evidence-derived language also rejects nonnumeric hallucinations.
  const allowedSummaries = [
    formatSkill(risk, domain).summary,
    ...risk.signals.map((s) => s.explanation),
  ];
  if (!allowedSummaries.includes(p.summary))
    failures.push({ field: "summary", code: "UNSUPPORTED_SUMMARY" });
  // Numerical factual assertions in the prose must appear in frozen evidence or policy explanations.
  const permittedNumbers = new Set(
    risk.signals.flatMap((s) => [String(s.value), String(s.threshold)]),
  );
  if (
    (p.summary.match(/\b\d+(?:\.\d+)?\b/g) ?? []).some(
      (n) => !permittedNumbers.has(n),
    )
  )
    failures.push({ field: "summary", code: "UNSUPPORTED_NUMBER" });
  return { valid: failures.length === 0, failures };
}

export type PolicyGuard = { version: string; facultyApproved: boolean };
export function acceptanceChecks(
  candidate: unknown,
  evidence: Evidence,
  risk: Risk,
  domain: (typeof domainNames)[number],
  policyGuard?: PolicyGuard,
  options: CheckOptions = {},
) {
  const v2 = options.version ? options.version === 2 : isPacketV2(candidate);
  const report = validateAnyPacket(candidate, evidence, risk, domain, {
    ...options,
    version: v2 ? 2 : 1,
  });
  const parsed = (v2 ? packetV2Schema : packetSchema).safeParse(candidate);
  const p = parsed.success
    ? { success: true as const, data: parsed.data as Packet | PacketV2 }
    : { success: false as const };
  const claimCodes = ["UNSUPPORTED_CITATION", "MISSING_TRIGGER_COVERAGE", "UNCITED_CLAIM"];
  const checks = {
    alerts_cite_triggers:
      p.success &&
      risk.signals.every((signal) =>
        p.data.citations.some(
          (c) =>
            c.evidencePath === signal.path &&
            c.statement === signal.explanation,
        ),
      ) &&
      !report.failures.some(
        (f) => f.field === "citations" || (v2 && claimCodes.includes(f.code)),
      ),
    thresholds_faculty_set: policyGuard
      ? policyGuard.facultyApproved &&
        policyGuard.version === risk.policyVersion
      : null,
    advisor_review_required:
      p.success &&
      p.data.actions.every((a) => a.owner === "assigned_faculty") &&
      !report.failures.some(
        (f) => f.code === "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS",
      ),
    privacy_scope_enforced:
      sourceNames.every(
        (name) => evidence[name].studentId === evidence.academic.studentId,
      ) &&
      (!(evidence as { tools?: { studentId?: string } }).tools ||
        (evidence as { tools?: { studentId?: string } }).tools!.studentId ===
          evidence.academic.studentId) &&
      !report.failures.some((f) => f.code === "OUTPUT_PII"),
  };
  const failures = [...report.failures];
  if (checks.thresholds_faculty_set === false)
    failures.push({ field: "citations", code: "THRESHOLDS_NOT_FACULTY_SET" });
  if (!checks.privacy_scope_enforced)
    failures.push({ field: "citations", code: "PRIVACY_SCOPE_MISMATCH" });
  if (!checks.advisor_review_required)
    failures.push({ field: "actions", code: "ADVISOR_REVIEW_REQUIRED" });
  return { valid: failures.length === 0, failures, checks };
}

export type GenerationContext = {
  evidence: Evidence;
  risk: Risk;
  domain: (typeof domainNames)[number];
  references: Array<{
    id: string;
    text: string;
    tags: string[];
    similarity: number;
    embeddingModel: string;
    actionCodes?: string[];
  }>;
  baseline: Packet | PacketV2;
  policyGuard?: PolicyGuard;
  /** approved policy (thresholds and weights may leave as numbers only) */
  policy?: Policy;
  /** in-scope identities the egress guard must never let leave */
  roster?: GuardRoster;
  /** per-run aliases shared by every model call for this case */
  aliases?: AliasMap;
  /** what the tool-using investigator did before drafting (Brief 12) */
  agent?: AgentRunSummary;
};
/** Visible trace of one agent loop: tool calls (aliased), turns, provider and
 * the labelled fallback. Results are never stored here, only hash and size. */
export type AgentRunSummary = {
  role: "investigator" | "planner";
  /** "tools" ran the loop; "standard-evidence" is today's behaviour, labelled */
  mode: "tools" | "standard-evidence";
  turns: number;
  modelCalls: number;
  budget: { maxTurns: number; maxToolCalls: number };
  toolCalls: Array<{
    seq: number;
    turn: number;
    tool: string;
    args: unknown;
    status: "ok" | "refused" | "error";
    code?: string;
    resultHash?: string;
    resultBytes?: number;
  }>;
  provider: string | null;
  model: string | null;
  tokens: number | null;
  latencyMs: number;
  fallbackReason: string | null;
  skippedReason?: string;
  /** values appended to the evidence snapshot under evidence.tools */
  evidenceValues: number;
  fallbacks: Array<{ provider: string; model: string; reason: string }>;
  egress: EgressAudit[];
};
/** Filled by a provider for each call so the run trace can show who served it. */
export type CallMeta = {
  provider?: string;
  model?: string;
  fallbacks: Array<{ provider: string; model: string; reason: string }>;
  egress: EgressAudit[];
  usage?: { prompt?: number; completion?: number; total?: number };
  latencyMs?: number;
};
export const newCallMeta = (): CallMeta => ({ fallbacks: [], egress: [] });
export interface Composer {
  modelId: string;
  generate(
    context: GenerationContext,
    failing?: Diagnosis[],
    prior?: unknown,
    meta?: CallMeta,
  ): Promise<unknown>;
}
function providerFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "MODEL_INVALID_JSON";
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return "MODEL_TIMEOUT";
  if (
    error instanceof Error &&
    /^(MODEL_(HTTP_[0-9]{3}|EMPTY_RESPONSE|RATE_LIMITED|DAILY_CAP)|EGRESS_BLOCKED)$/.test(
      error.message,
    )
  )
    return error.message;
  return "MODEL_UNAVAILABLE";
}
function withoutEgress(agent: AgentRunSummary) {
  return Object.fromEntries(
    Object.entries(agent).filter(([key]) => key !== "egress"),
  ) as Omit<AgentRunSummary, "egress">;
}
function summariseCalls(metas: CallMeta[]) {
  const served = [...metas].reverse().find((m) => m.provider);
  return {
    provider: served?.provider ?? null,
    model: served?.model ?? null,
    fallbacks: metas.flatMap((m) => m.fallbacks),
    egress: metas.flatMap((m) => m.egress),
    tokens: metas.reduce((n, m) => n + (m.usage?.total ?? 0), 0) || null,
    calls: metas.length,
  };
}
export async function compose(
  input: GenerationContext,
  provider?: Composer,
  runNode: RunNode = async (_id, work) => work(),
) {
  // packet-v2: one alias map per case run; the model works in alias space and
  // aliases are restored on the server only after validation passes.
  const v2 = isPacketV2(input.baseline);
  const context: GenerationContext = v2
    ? { ...input, aliases: input.aliases ?? buildAliases(input.evidence) }
    : input;
  const options: CheckOptions = {
    aliases: context.aliases,
    roster: context.roster,
    policy: context.policy,
    specialist: v2 ? (context.baseline as PacketV2).specialist : undefined,
    version: v2 ? 2 : 1,
  };
  const check = (packet: unknown, o: CheckOptions = options) =>
    acceptanceChecks(
      packet,
      context.evidence,
      context.risk,
      context.domain,
      context.policyGuard,
      o,
    );
  const baselineFields = context.baseline as unknown as Record<string, unknown>;
  let candidate: unknown = context.baseline;
  let mode: "deterministic" | "model" = "deterministic";
  let providerError: string | null = null;
  let baselineRepair = false;
  const repairs: Array<{ attempt: number; failures: Diagnosis[] }> = [];
  const modelAttempts: Array<{
    attempt: number;
    inputHash: string;
    output: unknown;
    outputHash: string;
    call?: CallMeta;
  }> = [];
  const metas: CallMeta[] = [];
  if (provider) {
    const meta = newCallMeta();
    metas.push(meta);
    try {
      const node = v2
        ? specialists[(context.baseline as PacketV2).specialist].node
        : undefined;
      candidate = node
        ? await runNode(node, () =>
            provider.generate(context, undefined, undefined, meta),
          )
        : await provider.generate(context, undefined, undefined, meta);
      mode = "model";
      modelAttempts.push({
        attempt: 0,
        inputHash: digest(context),
        output: candidate,
        outputHash: digest(candidate),
        call: meta,
      });
    } catch (error) {
      providerError = providerFailure(error);
    }
  }
  let report = await runNode("PacketValidator", () => check(candidate));
  for (
    let attempt = 1;
    validationRoute(report.valid, repairs.length) === "regenerate";
    attempt++
  ) {
    repairs.push({ attempt, failures: report.failures });
    let patch: unknown = context.baseline;
    if (provider) {
      const meta = newCallMeta();
      metas.push(meta);
      try {
        patch = await runNode("Regenerator", () =>
          provider.generate(context, report.failures, candidate, meta),
        );
        modelAttempts.push({
          attempt,
          inputHash: digest({ context, failures: report.failures, candidate }),
          output: patch,
          outputHash: digest(patch),
          call: meta,
        });
      } catch (error) {
        providerError = providerFailure(error);
      }
    }
    const current =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    const supplied =
      patch && typeof patch === "object" && !Array.isArray(patch)
        ? (patch as Record<string, unknown>)
        : {};
    candidate = { ...current };
    for (const { field } of report.failures) {
      if (supplied[field] === undefined) baselineRepair = true;
      (candidate as Record<string, unknown>)[field] =
        supplied[field] ?? baselineFields[field];
    }
    report = await runNode("PacketValidator", () => check(candidate));
  }
  // Server-side restoration, then the same checks on the restored text
  // (output PII scan included) without any alias map.
  let restored: unknown = candidate;
  let restoreFailures: Diagnosis[] = [];
  if (v2 && report.valid) {
    restored = restoreAliases(candidate, context.aliases!);
    const after = check(restored, { ...options, aliases: undefined });
    restoreFailures = after.failures;
  }
  const needsHuman =
    !!providerError ||
    !report.valid ||
    baselineRepair ||
    restoreFailures.length > 0;
  const offeredTemplate = check(context.baseline);
  const calls = summariseCalls(metas);
  return {
    packet: needsHuman
      ? context.baseline
      : v2
        ? packetV2Schema.parse(restored)
        : packetSchema.parse(candidate),
    mode: needsHuman ? ("deterministic" as const) : mode,
    modelId:
      !needsHuman && mode === "model"
        ? calls.model
          ? `${calls.provider}:${calls.model}`
          : provider!.modelId
        : null,
    validation: {
      ...report,
      failures: [...report.failures, ...restoreFailures],
      valid: !needsHuman && report.valid,
      repairs,
      fallback: needsHuman,
      escalated: needsHuman,
      templateValid: offeredTemplate.valid,
      providerError,
      modelAttempts,
      packetSchema: v2 ? "packet-v2" : "packet-v1",
      provenance: {
        ...calls,
        egress: [...calls.egress, ...(input.agent?.egress ?? [])],
        agent: input.agent ? withoutEgress(input.agent) : null,
        specialist: v2
          ? (context.baseline as PacketV2).specialist
          : context.domain,
        repairs: repairs.length,
        fallbackReason: needsHuman
          ? providerError
            ? `provider failed: ${providerError}`
            : baselineRepair
              ? "a repair needed template fields"
              : restoreFailures.length
                ? "restored text failed validation"
                : "validation failed after the repair budget"
          : null,
      },
      selection: {
        candidates: provider
          ? ["validated-baseline", "model-candidate"]
          : ["validated-baseline"],
        selected: needsHuman
          ? "template-offered-for-human-review"
          : mode === "model"
            ? "model-candidate"
            : "validated-baseline",
        rule: "Require full trigger coverage, scope, advisor review and approved policy. Persistent faults or provider failures stop at a human gate; templates are never auto-advanced.",
      },
    },
  };
}

export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      async () => {
        while (cursor < items.length) {
          const index = cursor++;
          results[index] = await worker(items[index]!, index);
        }
      },
    ),
  );
  return results;
}
export type Connector = {
  read(studentId: string, source: SourceName): Promise<Source>;
};
export async function collectSources(
  connector: Connector,
  studentId: string,
): Promise<Evidence> {
  const collected = await Promise.all(
    sourceNames.map(
      async (name) =>
        [
          name,
          sourceSchema.parse(await connector.read(studentId, name)),
        ] as const,
    ),
  );
  return Object.fromEntries(collected) as Evidence;
}

export const referenceLibrary: Reference[] = [
  {
    id: "GUIDE-ACADEMIC-1",
    text: "Academic marks study plan attendance mentor review weekly catch-up",
    tags: ["academic", "attendance"],
    departmentId: null,
  },
  {
    id: "GUIDE-LMS-1",
    text: "LMS inactivity overdue assignments quiz learning catch-up schedule",
    tags: ["academic", "attendance"],
    departmentId: null,
  },
  {
    id: "GUIDE-CAREER-1",
    text: "Internship placement missed milestones preparation mentor review",
    tags: ["academic"],
    departmentId: null,
  },
  {
    id: "GUIDE-REFERRAL-1",
    text: "Optional wellbeing support referral only with mentor judgement no diagnosis",
    tags: ["wellbeing-referral"],
    departmentId: null,
  },
];
