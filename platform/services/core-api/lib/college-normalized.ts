import { z } from "zod";
import type { ActorContext } from "@aura/contracts";
import { sourceSchema, sourceNames, digest, DataBlocked, type SourceName } from "./chapter11/engine";
import { loadAuthenticatedCollegeSources } from "./college-vault";
import { withCoreTransaction } from "./db";
import { AuthorizationError } from "./security";

/** A source owner must supply and approve normalization. Raw unknowns cannot pass this contract. */
export const normalizedCollegeBatchSchema = z.object({
  schemaVersion: z.literal("aura.approved-college-normalization.v1"), packageHash: z.string().regex(/^[a-f0-9]{64}$/),
  academicTerm: z.string().min(3).refine(value => !/^(unknown|unconfirmed|tbd)$/i.test(value), "Academic term is unconfirmed"),
  periodStart: z.string().date(), periodEnd: z.string().date(), sourceDefinitionsConfirmed: z.literal(true),
  mentorApprovals: z.array(z.object({ studentId: z.string().uuid(), mentorId: z.string().uuid(), approvalReference: z.string().min(3) }).strict()).min(1),
  approvalReference: z.string().min(3), normalizationRules: z.string().min(12),
  records: z.array(sourceSchema.extend({ synthetic: z.literal(false) }).strict()).min(4),
}).strict().superRefine((batch, ctx) => {
  if (batch.periodEnd < batch.periodStart) ctx.addIssue({ code: "custom", message: "Reporting period ends before it starts" });
  const seen = new Set<string>();
  const students = new Set(batch.records.map(record => record.studentId));
  if (new Set(batch.mentorApprovals.map(approval => approval.studentId)).size !== batch.mentorApprovals.length ||
      batch.mentorApprovals.some(approval => !students.has(approval.studentId)) ||
      [...students].some(studentId => !batch.mentorApprovals.some(approval => approval.studentId === studentId)))
    ctx.addIssue({ code: "custom", message: "Each student requires exactly one matched mentor approval" });
  for (const record of batch.records) {
    const key = `${record.studentId}:${record.source}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate normalized source" }); seen.add(key);
    if (record.semester !== batch.academicTerm) ctx.addIssue({ code: "custom", message: "Normalization term mismatch" });
    if (record.state === "missing" || ((record.source === "academic" || record.source === "lms") && record.state !== "present")) ctx.addIssue({ code: "custom", message: "Required source evidence is missing" });
    const keys = record.source === "academic" ? ["attendancePct", "markPct"] : record.source === "lms" ? ["inactivityDays", "overdueAssignments"] : record.source === "internship" ? ["missedMilestones"] : ["missedActivities"];
    if (Object.keys(record.values).some(key => !keys.includes(key)) || (record.state === "not_applicable" && Object.keys(record.values).length)) ctx.addIssue({ code: "custom", message: "Only approved source measurements may enter normalized model context" });
    if (record.state === "present") for (const keyName of keys) {
      const value = record.values[keyName];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (keyName.endsWith("Pct") && value > 100)) ctx.addIssue({ code: "custom", message: "Approved normalization requires actual valid measurements" });
    }
  }
  for (const student of new Set(batch.records.map(r => r.studentId))) if (sourceNames.some(source => !seen.has(`${student}:${source}`))) ctx.addIssue({ code: "custom", message: "All four source states must be explicit for each student" });
});

export async function readApprovedCollegeSource(actor: ActorContext, studentId: string, source: SourceName) {
  const batchHash = process.env.COLLEGE_NORMALIZATION_BATCH_HASH, packageHash = process.env.COLLEGE_ACTIVE_PACKAGE_HASH;
  if (!batchHash || !packageHash) throw new DataBlocked(["Source normalization has not been approved. Raw dates, units and linked evidence remain unknown."]);
  const scope = await loadAuthenticatedCollegeSources(actor);
  if (!scope.students.some(s => s.id === studentId)) throw new AuthorizationError("Normalized source is outside the current verified account scope");
  return withCoreTransaction(async client => {
    const result = await client.query<{ batch: unknown }>("SELECT batch FROM college_normalization_vault WHERE batch_hash=$1 AND package_hash=$2", [batchHash, packageHash]);
    const batch = normalizedCollegeBatchSchema.parse(result.rows[0]?.batch);
    if (digest(batch) !== batchHash) throw new DataBlocked(["Normalized source integrity check failed"]);
    const record = batch.records.find(r => r.studentId === studentId && r.source === source);
    if (!record) throw new DataBlocked([`${source}: approved linked evidence is not supplied for this student`]);
    return record;
  });
}
