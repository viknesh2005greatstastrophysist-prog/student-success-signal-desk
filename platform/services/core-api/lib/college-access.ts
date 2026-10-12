import { z } from "zod";
import type { ActorContext } from "@aura/contracts";
import type { CollegeAttendanceReview } from "./chapter11/college-attendance-review";
import { AuthorizationError } from "./security";

export const collegeAccessSchema = z.object({
  schemaVersion: z.literal("aura.verified-college-access.v1"), datasetHash: z.string().regex(/^[a-f0-9]{64}$/),
  dataAccessApproved: z.literal(true), approvedBy: z.string().min(3), approvalReference: z.string().min(3),
  sourceDepartments: z.array(z.object({ sourceId: z.string().regex(/^[a-f0-9]{64}$/), departmentId: z.string().uuid() }).strict()).min(1),
  users: z.array(z.object({ subject: z.string().min(1), personId: z.string().uuid(), role: z.enum(["student", "parent", "faculty", "hod", "governance"]),
    studentIds: z.array(z.string().uuid()), departmentId: z.string().uuid().nullable(), fieldGroups: z.array(z.enum(["attendance", "marks", "course_metadata"])),
    identityVerified: z.literal(true), mappingVerifiedBy: z.string().min(3), mappingReference: z.string().min(3),
    parentRelationshipVerified: z.boolean(),
  }).strict()).min(1),
}).strict().superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(data.users.map(u => u.subject)).size !== data.users.length || new Set(data.users.map(u => u.personId)).size !== data.users.length) fail("Ambiguous college identity");
  if (new Set(data.sourceDepartments.map(s => s.sourceId)).size !== data.sourceDepartments.length) fail("Duplicate source department mapping");
  for (const user of data.users) {
    if (/^aura-(demo|cohort)/.test(user.subject) || user.subject.endsWith("@aura.example")) fail("Demonstration identities cannot access actual college records");
    if (user.role === "student" && user.studentIds.length !== 1) fail("Each student account requires exactly one verified source identity");
    if (user.role === "parent" && (!user.parentRelationshipVerified || !user.studentIds.length || !user.fieldGroups.length)) fail("Parent relationship and field grants must be verified");
    if ((user.role === "hod" || user.role === "faculty") && !user.departmentId) fail("Department assignment is required");
    if (new Set(user.studentIds).size !== user.studentIds.length) fail("Duplicate scoped student");
  }
});
export type CollegeAccess = z.infer<typeof collegeAccessSchema>;

export function validateCollegeAccess(input: unknown, review: CollegeAttendanceReview, datasetHash: string): CollegeAccess {
  const access = collegeAccessSchema.parse(input);
  if (access.datasetHash !== datasetHash) throw new AuthorizationError("Access mapping belongs to a different college dataset");
  if (review.sources.some(s => !access.sourceDepartments.some(m => m.sourceId === s.id)) || access.sourceDepartments.some(m => !review.sources.some(s => s.id === m.sourceId))) throw new AuthorizationError("Source department mappings are incomplete or unrelated");
  for (const user of access.users) if (user.studentIds.some(id => !review.students.some(s => s.id === id))) throw new AuthorizationError("A mapped student is outside this dataset");
  return access;
}

export function projectCollegeSources(actor: ActorContext, review: CollegeAttendanceReview, input: unknown, datasetHash: string,
  liveScope: { studentIds: string[]; perStudentFields?: Record<string, string[]> }) {
  const access = validateCollegeAccess(input, review, datasetHash);
  const user = access.users.find(u => u.subject === actor.subject && u.personId === actor.personId && u.role === actor.role);
  if (!user) throw new AuthorizationError("No verified college account mapping exists for this identity");
  if (!liveScope || (actor.role === "parent" && !liveScope.perStudentFields)) throw new AuthorizationError("Current assignment and field-grant scope is required");
  if (user.departmentId && user.departmentId !== actor.departmentId) throw new AuthorizationError("Authenticated department differs from the college assignment");
  if (actor.role === "student" && actor.studentId !== user.studentIds[0]) throw new AuthorizationError("Student identity differs from the verified source mapping");
  const allowedSources = new Set(access.sourceDepartments.filter(m => !user.departmentId || m.departmentId === user.departmentId).map(m => m.sourceId));
  const inDepartment = review.students.filter(s => s.reports.some(r => allowedSources.has(r.sourceId)));
  const scoped = (actor.role === "hod" || actor.role === "governance" ? inDepartment : inDepartment.filter(s => user.studentIds.includes(s.id)))
    .filter(s => liveScope.studentIds.includes(s.id));
  const scopedSourceIds = new Set(scoped.flatMap(s => s.reports.filter(r => allowedSources.has(r.sourceId)).map(r => r.sourceId)));
  if (actor.role === "governance") return { datasetHash, actorRole: actor.role, privacy: "authenticated_aggregate", students: [], sources: [],
    counts: { students: scoped.length, sources: allowedSources.size }, unknowns: ["reporting periods", "source meanings", "linked LMS and career evidence", "approved policy"], riskScore: null, studentSupportPublicationAllowed: false };
  const students = scoped.map(s => ({ id: s.id, name: s.name, srn: s.srn, reports: s.reports.filter(r => allowedSources.has(r.sourceId)).map(r => ({
    semester: r.semester, section: r.section, sourceId: r.sourceId,
    cells: r.courses.filter(c => { const fields = new Set(user.fieldGroups.filter(field => !liveScope?.perStudentFields || liveScope.perStudentFields[s.id]?.includes(field)));
      return c.field.startsWith("Attendance") || c.field === "Recorded attendance" ? fields.has("attendance") : c.field.startsWith("CIE") ? fields.has("marks") : fields.has("course_metadata"); })
      .map(c => ({ course: c.course, field: c.field, rawValue: c.value, sourceCell: c.cell })),
  })) }));
  return { datasetHash, actorRole: actor.role, privacy: "authenticated_scoped", students,
    sources: review.sources.filter(s => allowedSources.has(s.id) && students.some(student => student.reports.some(r => r.sourceId === s.id))).map(s => ({ id: s.id, filename: s.filename, sheet: s.sheet ?? "Full_Attendance" })),
    counts: { students: students.length, sources: scopedSourceIds.size }, unknowns: ["reporting periods", "source meanings", "linked LMS and career evidence", "approved policy"], riskScore: null, studentSupportPublicationAllowed: false };
}
