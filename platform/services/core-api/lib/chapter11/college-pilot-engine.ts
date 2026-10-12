import { z } from "zod";
import { digest, retrieve } from "./engine";
import type { CollegeAttendanceReview } from "./college-attendance-review";
import { decodeModelContent } from "./provider";

export const taskCatalogue = {
  period: "Confirm the academic year and reporting period for each source.",
  attendance_meaning: "Confirm attendance units and the meanings of zero, NA, TNS and dash.",
  marks_scale: "Confirm maximum CIE marks, component weights and eligibility rules.",
  missing_marks: "Supply dated course marks and maximum marks for this student.",
  mentor_mapping: "Confirm the student's actual assigned mentor and institutional course mapping.",
  approved_policy: "Obtain the mentor-approved review policy, rationale and permitted support actions.",
  lms_evidence: "Supply authorized lesson/submission records, due dates and observation dates.",
  career_evidence: "Supply internship and placement evidence or confirmed non-applicability.",
} as const;
export type TaskCode = keyof typeof taskCatalogue;
const taskCode = z.enum(Object.keys(taskCatalogue) as [TaskCode, ...TaskCode[]]);
export const orderSchema = z.object({ taskCodes: z.array(taskCode).min(1).max(8) }).strict();
export type Order = z.infer<typeof orderSchema>;
export type Cell = { sourceId: string; sheet: string; cell: string; course: string; field: string; rawValue: string | number; semester: number; section: string };
export type Snapshot = {
  studentId: string; displayId: string; cells: Cell[];
  sources: Array<{ source: "academic" | "lms" | "internship" | "placement"; state: "raw_uninterpreted" | "missing"; observedAt: null }>;
  hasCie: boolean; riskScore: null; riskBand: null; academicYear: null; mentorId: null;
};
export type Packet = {
  schemaVersion: "aura.college-readiness-packet.v1"; purpose: "source_readiness";
  studentId: string; snapshotHash: string; summary: string;
  facts: Array<{ ref: string; statement: string }>;
  tasks: Array<{ code: TaskCode; label: string; owner: "source_owner_unassigned" }>;
  unknowns: string[]; riskScore: null; mentorId: null; studentPublicationAllowed: false;
};
export function collegeDatasetHash(review: CollegeAttendanceReview) {
  return digest({ attendanceDatasetId: review.datasetId, sources: review.sources,
    students: review.students.map(student => ({ id: student.id, displayId: student.displayId, name: student.name, srn: student.srn, reports: student.reports })) });
}
const guides = [
  { id: "SOURCE-DATES", text: "Import and generation timestamps do not establish an academic observation period.", tags: ["source-readiness", "period"], departmentId: null },
  { id: "SOURCE-SEMANTICS", text: "Keep numeric zero, missing fields and source status tokens distinct. Raw marks need a confirmed maximum before normalization.", tags: ["source-readiness", "semantics"], departmentId: null },
  { id: "HUMAN-AUTHORITY", text: "A local project review accepts a clarification checklist. Actual mentor assignment, approved policy and faculty sign-off are separate requirements.", tags: ["source-readiness", "authority"], departmentId: null },
];

/** The raw contract deliberately has no fabricated date, percentage or source state. */
export async function collectCollegeSources(review: CollegeAttendanceReview, studentId: string): Promise<Snapshot> {
  const student = review.students.find(s => s.id === studentId);
  if (!student) throw new Error("STUDENT_OUT_OF_SCOPE");
  const [academic, lms, internship, placement] = await Promise.all([
    Promise.resolve({ source: "academic" as const, state: "raw_uninterpreted" as const, observedAt: null }),
    Promise.resolve({ source: "lms" as const, state: "missing" as const, observedAt: null }),
    Promise.resolve({ source: "internship" as const, state: "missing" as const, observedAt: null }),
    Promise.resolve({ source: "placement" as const, state: "missing" as const, observedAt: null }),
  ]);
  const cells = student.reports.flatMap(report => {
    const source = review.sources.find(s => s.id === report.sourceId);
    if (!source) throw new Error("SOURCE_OUT_OF_SCOPE");
    return report.courses.map(cell => ({ sourceId: source.id, sheet: source.sheet ?? "Full_Attendance", cell: cell.cell,
      course: cell.course, field: cell.field, rawValue: cell.value, semester: report.semester, section: report.section }));
  });
  return { studentId, displayId: student.displayId, cells, sources: [academic, lms, internship, placement],
    hasCie: cells.some(c => c.field === "CIE"), riskScore: null, riskBand: null, academicYear: null, mentorId: null };
}

export function requiredTasks(snapshot: Snapshot): TaskCode[] {
  return ["period", "attendance_meaning", snapshot.hasCie ? "marks_scale" : "missing_marks", "mentor_mapping", "approved_policy", "lms_evidence", "career_evidence"];
}
export function validateOrder(input: unknown, allowed: TaskCode[]): Order {
  const order = orderSchema.parse(input);
  if (order.taskCodes.length !== allowed.length || new Set(order.taskCodes).size !== allowed.length || order.taskCodes.some(code => !allowed.includes(code))) throw new Error("ORDER_MUST_RETAIN_ALL_REQUIRED_TASKS");
  return order;
}
export function snapshotReferences(snapshot: Snapshot) {
  return retrieve("reporting period attendance units source completeness human authority", ["source-readiness"], guides, "private-local", snapshot.studentId);
}
export function formatReadinessPacket(snapshot: Snapshot, order: Order): Packet {
  validateOrder(order, requiredTasks(snapshot));
  // Select representative cells from each source; the complete frozen snapshot is retained separately.
  const selected: Cell[] = [];
  for (const source of new Set(snapshot.cells.map(c => c.sourceId))) selected.push(...snapshot.cells.filter(c => c.sourceId === source).slice(0, 4));
  return { schemaVersion: "aura.college-readiness-packet.v1", purpose: "source_readiness", studentId: snapshot.studentId, snapshotHash: digest(snapshot),
    summary: "Source records are available, but required definitions and linked evidence are missing. Student risk has not been calculated.",
    facts: selected.map(c => ({ ref: `${c.sourceId}:${c.sheet}!${c.cell}`, statement: `${c.course} / ${c.field}: recorded value ${String(c.rawValue) || "[blank]"}. Meaning and reporting period remain unconfirmed.` })),
    tasks: order.taskCodes.map(code => ({ code, label: taskCatalogue[code], owner: "source_owner_unassigned" })),
    unknowns: ["academic year and reporting periods", "attendance units and status definitions", snapshot.hasCie ? "CIE scale and eligibility rules" : "dated course marks", "actual mentor and course mappings", "approved institutional policy", "LMS activity", "internship and placement applicability"],
    riskScore: null, mentorId: null, studentPublicationAllowed: false };
}
export function validateReadinessPacket(packet: Packet, snapshot: Snapshot) {
  const canonical = formatReadinessPacket(snapshot, { taskCodes: packet.tasks.map(t => t.code) });
  if (digest(packet) !== digest(canonical)) throw new Error("UNSUPPORTED_PACKET_OR_CITATION");
  return true;
}

export type OrderingResult = { order: Order; method: "local_model" | "deterministic"; modelId: string | null;
  fallback: boolean; attempts: Array<{ attempt: number; accepted: boolean; outputHash?: string; diagnosis?: string }>; inputHash: string };
export interface ReadinessComposer { modelId: string; generate(taskCodes: TaskCode[], repair?: string): Promise<unknown> }
export async function chooseReadinessOrder(snapshot: Snapshot, composer?: ReadinessComposer): Promise<OrderingResult> {
  const allowed = requiredTasks(snapshot), inputHash = digest({ purpose: "source_readiness", taskCodes: allowed, modelId: composer?.modelId ?? null });
  const attempts: OrderingResult["attempts"] = [];
  if (composer) for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candidate = await composer.generate(allowed, attempt ? "Retain every supplied task code exactly once; no extra fields or prose." : undefined);
      const order = validateOrder(candidate, allowed);
      attempts.push({ attempt, accepted: true, outputHash: digest(candidate) });
      return { order, method: "local_model", modelId: composer.modelId, fallback: false, attempts, inputHash };
    } catch (error) {
      attempts.push({ attempt, accepted: false, diagnosis: error instanceof Error && error.message.startsWith("MODEL_HTTP_") ? error.message : "MODEL_OUTPUT_INVALID_OR_UNAVAILABLE" });
    }
  }
  return { order: { taskCodes: allowed }, method: "deterministic", modelId: composer?.modelId ?? null, fallback: !!composer, attempts, inputHash };
}

/** Existing local configuration is reused. No real student records reach a remote model. */
export function localReadinessComposer(env: Record<string, string | undefined> = process.env): ReadinessComposer | undefined {
  const base = env.CH11_MODEL_BASE_URL, modelId = env.CH11_MODEL;
  if (!base || !modelId) return undefined;
  const url = new URL(base);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("PRIVATE_PILOT_REQUIRES_LOCAL_MODEL_ENDPOINT");
  return { modelId, async generate(taskCodes, repair) {
    const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, { method: "POST", signal: AbortSignal.timeout(45000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, temperature: 0, max_tokens: 400, reasoning_effort: "none",
        response_format: { type: "json_schema", json_schema: { name: "source_readiness_order", strict: true, schema: z.toJSONSchema(orderSchema) } },
        messages: [{ role: "system", content: "Order predefined clarification tasks by dependency: establish source meaning and authority before interpretation. Return only JSON taskCodes, with every supplied code exactly once. You may change order only. You cannot infer definitions, judge student risk, choose policy, contact anyone or approve any action. No prose or other fields." },
          { role: "user", content: JSON.stringify({ tasks: taskCodes.map(code => ({ code, question: taskCatalogue[code] })), repair: repair ?? null }) }] }) });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content || content.length > 12000) throw new Error("MODEL_EMPTY_OR_OVERSIZE_RESPONSE");
    return decodeModelContent(content);
  } };
}
