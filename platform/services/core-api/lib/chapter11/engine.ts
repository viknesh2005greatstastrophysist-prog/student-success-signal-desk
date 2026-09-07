import { createHash } from "node:crypto";
import { z } from "zod";

export const sourceNames = ["academic", "lms", "internship", "placement"] as const;
export const domainNames = ["academic", "attendance", "wellbeing-referral"] as const;
export type SourceName = typeof sourceNames[number];
export const policySchema = z.object({
  version: z.string().min(3).max(80),
  attendanceMinimum: z.number().min(0).max(100), markMinimum: z.number().min(0).max(100),
  inactivityMaximum: z.number().int().min(1).max(90),
  mediumScore: z.number().min(1).max(99), highScore: z.number().min(2).max(100),
  freshnessDays: z.number().int().min(1).max(365),
}).strict().refine(p => p.highScore > p.mediumScore, "High threshold must exceed medium threshold");
export type Policy = z.infer<typeof policySchema>;
export const demoPolicy: Policy = { version: "CH11-DEMO-1", attendanceMinimum: 75, markMinimum: 60, inactivityMaximum: 7, mediumScore: 20, highScore: 50, freshnessDays: 30 };

export const planInputSchema = z.object({
  request: z.string().trim().min(3).max(2000),
  studentIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  domain: z.enum(domainNames).optional(),
  policyId: z.string().uuid().optional(),
  feedback: z.string().trim().max(1000).default(""),
  mode: z.enum(["deterministic", "model"]).default("deterministic"),
}).strict();
export type PlanInput = z.infer<typeof planInputSchema>;
export function planSkill(input: PlanInput) {
  const questions: string[] = [];
  if (!input.studentIds?.length) questions.push("Which students should this review cover?");
  if (!input.domain) questions.push("Should this review focus on academics, attendance, or a wellbeing referral?");
  if (!input.policyId) questions.push("Which mentor-approved threshold policy should this review use?");
  return {
    ...input, questions, ready: questions.length === 0,
    steps: ["Collect four scoped sources in parallel", "Check freshness and completeness", "Compute approved risk policy", "Retrieve tagged references", "Draft and validate a plan", "Wait for mentor approval", "Publish and track approved interventions"],
    budget: { maxStudents: 50, concurrency: 4, maxRepairs: 2, modelTimeoutMs: 45000 },
  };
}

export const sourceSchema = z.object({
  source: z.enum(sourceNames), studentId: z.string().uuid(), recordId: z.string().min(1),
  observedAt: z.string().datetime(), semester: z.string().min(1),
  state: z.enum(["present", "missing", "not_applicable"]), synthetic: z.boolean(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
}).strict();
export type Source = z.infer<typeof sourceSchema>;
export type Evidence = Record<SourceName, Source>;
export type Signal = { code: string; source: SourceName; path: string; value: number; threshold: number; points: number; explanation: string };
export type Risk = { score: number; band: "low" | "medium" | "high"; flagged: boolean; signals: Signal[]; policyVersion: string; reviewRequired: true };
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export class DataBlocked extends Error { constructor(readonly reasons: string[]) { super(reasons.join("; ")); } }
export function validateEvidence(evidence: Evidence, studentId: string, policy: Policy, at: string, semester: string) {
  const failures: string[] = [];
  for (const name of sourceNames) {
    const parsed = sourceSchema.safeParse(evidence[name]);
    if (!parsed.success) { failures.push(`${name}: invalid source contract`); continue; }
    const record = parsed.data;
    if (record.studentId !== studentId || record.source !== name || record.semester !== semester) failures.push(`${name}: scope mismatch`);
    const age = Date.parse(at) - Date.parse(record.observedAt);
    if (age < -60000 || age > policy.freshnessDays * 86400000) failures.push(`${name}: stale or future evidence`);
    if (record.state === "missing" || ((name === "academic" || name === "lms") && record.state !== "present")) failures.push(`${name}: required evidence missing`);
    if (record.state === "present") {
      const keys = name === "academic" ? ["attendancePct", "markPct"] : name === "lms" ? ["inactivityDays", "overdueAssignments"] : name === "internship" ? ["missedMilestones"] : ["missedActivities"];
      for (const key of keys) {
        const value = record.values[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || ((key.endsWith("Pct")) && value > 100)) failures.push(`${name}.${key}: invalid or absent number`);
      }
    }
  }
  if (failures.length) throw new DataBlocked(failures);
}
export function riskAnalysis(evidence: Evidence, policy: Policy): Risk {
  const signals: Signal[] = [];
  const check = (source: SourceName, key: string, threshold: number, below: boolean, points: number, code: string) => {
    if (evidence[source].state !== "present") return;
    const value = evidence[source].values[key] as number;
    if (below ? value < threshold : value >= threshold) signals.push({ code, source, path: `evidence.${source}.values.${key}`, value, threshold, points, explanation: `${key} is ${value}; policy threshold is ${below ? "below" : "at least"} ${threshold}.` });
  };
  check("academic", "attendancePct", policy.attendanceMinimum, true, 20, "ATTENDANCE_LOW");
  check("academic", "markPct", policy.markMinimum, true, 20, "MARK_LOW");
  check("lms", "inactivityDays", policy.inactivityMaximum, false, 20, "LMS_INACTIVE");
  check("lms", "overdueAssignments", 1, false, 10, "ASSIGNMENT_OVERDUE");
  check("internship", "missedMilestones", 1, false, 15, "INTERNSHIP_MILESTONE");
  check("placement", "missedActivities", 1, false, 15, "PLACEMENT_ACTIVITY");
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.points, 0));
  return { score, band: score >= policy.highScore ? "high" : score >= policy.mediumScore ? "medium" : "low", flagged: score >= policy.mediumScore, signals, policyVersion: policy.version, reviewRequired: true };
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
  return vector.map(v => v / norm);
}
export type Reference = { id: string; text: string; tags: string[]; departmentId: string | null; studentId?: string; embedding?: number[] };
export function retrieve(query: string, tags: string[], references: Reference[], departmentId: string, studentId: string) {
  const q = embed(query);
  return references.filter(r => (r.departmentId === null || r.departmentId === departmentId) && (!r.studentId || r.studentId === studentId) && tags.some(t => r.tags.includes(t)))
    .map(r => ({ id: r.id, text: r.text, tags: r.tags, similarity: q.reduce((n, x, i) => n + x * (r.embedding ?? embed(r.text))[i]!, 0), embeddingModel: "sha256-lexical-128-v1" }))
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)).slice(0, 5);
}

export const actions = {
  "faculty-check-in": "Schedule a 20-minute academic check-in with the assigned mentor",
  "student-study-plan": "Agree a weekly study plan with the assigned mentor",
  "attendance-review": "Review attendance barriers and agree an attendance plan with the mentor",
  "lms-catch-up": "Agree a catch-up schedule for overdue learning activities",
  "internship-review": "Review missed internship milestones with the assigned mentor",
  "placement-review": "Review placement preparation activities with the assigned mentor",
  "wellbeing-referral": "Ask the mentor whether an optional support-service referral is appropriate",
} as const;
export const packetSchema = z.object({
  summary: z.string().min(12).max(600),
  actions: z.array(z.object({ code: z.enum(Object.keys(actions) as [keyof typeof actions, ...Array<keyof typeof actions>]), label: z.string().min(8).max(180), owner: z.enum(["assigned_faculty", "student"]), dueInDays: z.number().int().min(1).max(14) }).strict()).min(1).max(4),
  citations: z.array(z.object({ evidencePath: z.string(), statement: z.string().min(4).max(180) }).strict()).min(1).max(10),
  prohibited: z.array(z.string()).max(0),
}).strict();
export type Packet = z.infer<typeof packetSchema>;
export const specialists: Record<typeof domainNames[number], { codes: Array<keyof typeof actions>; instruction: string }> = {
  academic: { codes: ["faculty-check-in", "student-study-plan", "lms-catch-up", "internship-review", "placement-review"], instruction: "Explain academic support options without diagnosing or predicting failure." },
  attendance: { codes: ["faculty-check-in", "attendance-review", "lms-catch-up"], instruction: "Focus on attendance barriers and feasible mentor-led catch-up." },
  "wellbeing-referral": { codes: ["faculty-check-in", "wellbeing-referral"], instruction: "Never infer a mental-health condition. Only offer an optional mentor-led referral." },
};
export function formatSkill(risk: Risk, domain: typeof domainNames[number]): Packet {
  const codes = specialists[domain].codes;
  const relevant: Array<keyof typeof actions> = domain === "attendance" ? ["attendance-review"] : domain === "wellbeing-referral" ? ["wellbeing-referral"] : risk.signals.map(s => s.source === "lms" ? "lms-catch-up" : s.source === "internship" ? "internship-review" : s.source === "placement" ? "placement-review" : "student-study-plan");
  return {
    summary: `Mentor review requested: ${risk.signals.map(s => s.code.toLowerCase().replaceAll("_", " ")).join(", ") || "routine evidence review"}.`,
    actions: [...new Set<keyof typeof actions>(["faculty-check-in", ...relevant])].filter(c => codes.includes(c)).slice(0, 4).map(code => ({ code, label: actions[code], owner: "assigned_faculty", dueInDays: 7 })),
    citations: risk.signals.length ? risk.signals.map(s => ({ evidencePath: s.path, statement: s.explanation })) : [{ evidencePath: "evidence.academic.values.attendancePct", statement: "The academic record is available for routine review." }],
    prohibited: [],
  };
}
export type Diagnosis = { field: "summary" | "actions" | "citations" | "prohibited"; code: string };
export function validatePacket(candidate: unknown, evidence: Evidence, risk: Risk, domain: typeof domainNames[number]): { valid: boolean; failures: Diagnosis[] } {
  const parsed = packetSchema.safeParse(candidate);
  if (!parsed.success && (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))) return { valid: false, failures: (["summary", "actions", "citations", "prohibited"] as const).map(field => ({ field, code: "SCHEMA_INVALID" })) };
  if (!parsed.success) return { valid: false, failures: parsed.error.issues.map(i => ({ field: (["summary", "actions", "citations", "prohibited"].includes(String(i.path[0])) ? i.path[0] : "summary") as Diagnosis["field"], code: "SCHEMA_INVALID" })) };
  const p = parsed.data;
  const failures: Diagnosis[] = [];
  const unsafe = /diagnos|depress|suicid|automatically contact|email the parent|send.*message|change.*mark|guarantee|will fail|punish|expel/i;
  if (unsafe.test(p.summary)) failures.push({ field: "summary", code: "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS" });
  if (p.actions.some(a => !specialists[domain].codes.includes(a.code) || a.label !== actions[a.code] || a.owner !== "assigned_faculty")) failures.push({ field: "actions", code: "CATALOGUE_OR_DOMAIN_MISMATCH" });
  const canonicalClaims = new Map(formatSkill(risk, domain).citations.map(c => [c.evidencePath, c.statement]));
  for (const c of p.citations) {
    const parts = c.evidencePath.split(".");
    const source = parts[1] as SourceName;
    if (parts.length !== 4 || parts[0] !== "evidence" || parts[2] !== "values" || !sourceNames.includes(source) || evidence[source]?.values[parts[3]!] === undefined || canonicalClaims.get(c.evidencePath) !== c.statement) failures.push({ field: "citations", code: "UNSUPPORTED_CITATION" });
  }
  if (risk.signals.some(s => !p.citations.some(c => c.evidencePath === s.path))) failures.push({ field: "citations", code: "MISSING_TRIGGER_COVERAGE" });
  // A closed evidence-derived language also rejects nonnumeric hallucinations.
  const allowedSummaries = [formatSkill(risk, domain).summary, ...risk.signals.map(s => s.explanation)];
  if (!allowedSummaries.includes(p.summary)) failures.push({ field: "summary", code: "UNSUPPORTED_SUMMARY" });
  // Numerical factual assertions in the prose must appear in frozen evidence or policy explanations.
  const permittedNumbers = new Set(risk.signals.flatMap(s => [String(s.value), String(s.threshold)]));
  if ((p.summary.match(/\b\d+(?:\.\d+)?\b/g) ?? []).some(n => !permittedNumbers.has(n))) failures.push({ field: "summary", code: "UNSUPPORTED_NUMBER" });
  return { valid: failures.length === 0, failures };
}

export type GenerationContext = { evidence: Evidence; risk: Risk; domain: typeof domainNames[number]; references: ReturnType<typeof retrieve>; baseline: Packet };
export interface Composer { modelId: string; generate(context: GenerationContext, failing?: Diagnosis[], prior?: unknown): Promise<unknown> }
function providerFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "MODEL_INVALID_JSON";
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return "MODEL_TIMEOUT";
  if (error instanceof Error && /^MODEL_(HTTP_[0-9]{3}|EMPTY_RESPONSE)$/.test(error.message)) return error.message;
  return "MODEL_UNAVAILABLE";
}
export async function compose(context: GenerationContext, provider?: Composer) {
  let candidate: unknown = context.baseline;
  let mode: "deterministic" | "model" = "deterministic";
  let providerError: string | null = null;
  let baselineRepair = false;
  const repairs: Array<{ attempt: number; failures: Diagnosis[] }> = [];
  const modelAttempts: Array<{ attempt: number; inputHash: string; output: unknown; outputHash: string }> = [];
  if (provider) {
    try { candidate = await provider.generate(context); mode = "model"; modelAttempts.push({ attempt: 0, inputHash: digest(context), output: candidate, outputHash: digest(candidate) }); }
    catch (error) { providerError = providerFailure(error); }
  }
  let report = validatePacket(candidate, context.evidence, context.risk, context.domain);
  for (let attempt = 1; !report.valid && attempt <= 2; attempt++) {
    repairs.push({ attempt, failures: report.failures });
    let patch: unknown = context.baseline;
    if (provider) { try { patch = await provider.generate(context, report.failures, candidate); modelAttempts.push({ attempt, inputHash: digest({ context, failures: report.failures, candidate }), output: patch, outputHash: digest(patch) }); } catch (error) { providerError = providerFailure(error); } }
    const current = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
    const supplied = patch && typeof patch === "object" && !Array.isArray(patch) ? patch as Record<string, unknown> : {};
    candidate = { ...current };
    for (const { field } of report.failures) {
      if (supplied[field] === undefined) baselineRepair = true;
      (candidate as Record<string, unknown>)[field] = supplied[field] ?? context.baseline[field];
    }
    report = validatePacket(candidate, context.evidence, context.risk, context.domain);
  }
  const fallback = !!providerError || !report.valid || baselineRepair;
  if (fallback) { candidate = context.baseline; mode = "deterministic"; report = validatePacket(candidate, context.evidence, context.risk, context.domain); }
  if (!report.valid) throw new Error("VALIDATION_BLOCKED");
  return { packet: packetSchema.parse(candidate), mode, modelId: mode === "model" ? provider!.modelId : null, validation: { ...report, repairs, fallback, providerError, modelAttempts, selection: { candidates: provider ? ["validated-baseline", "model-candidate"] : ["validated-baseline"], selected: mode === "model" ? "model-candidate" : "validated-baseline", rule: "Reject failed candidates; require full trigger coverage and domain catalogue alignment; prefer a validated model candidate on equal coverage." } } };
}

export async function parallelMap<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await worker(items[index]!, index); }
  }));
  return results;
}
export type Connector = { read(studentId: string, source: SourceName): Promise<Source> };
export async function collectSources(connector: Connector, studentId: string): Promise<Evidence> {
  const collected = await Promise.all(sourceNames.map(async name => [name, sourceSchema.parse(await connector.read(studentId, name))] as const));
  return Object.fromEntries(collected) as Evidence;
}

export const referenceLibrary: Reference[] = [
  { id: "GUIDE-ACADEMIC-1", text: "Academic marks study plan attendance mentor review weekly catch-up", tags: ["academic", "attendance"], departmentId: null },
  { id: "GUIDE-LMS-1", text: "LMS inactivity overdue assignments quiz learning catch-up schedule", tags: ["academic", "attendance"], departmentId: null },
  { id: "GUIDE-CAREER-1", text: "Internship placement missed milestones preparation mentor review", tags: ["academic"], departmentId: null },
  { id: "GUIDE-REFERRAL-1", text: "Optional wellbeing support referral only with mentor judgement no diagnosis", tags: ["wellbeing-referral"], departmentId: null },
];
