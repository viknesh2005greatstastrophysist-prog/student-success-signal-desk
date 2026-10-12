import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { collegeAttendanceSchema } from "./college-attendance";
import { validateCieIdentities } from "./college-cie";

export const collegeSourceContextSchema = z.object({
  schemaVersion: z.literal("aura.college-source-context.v1"),
  datasetId: z.string().regex(/^[a-f0-9]{64}$/),
  permission: z.object({
    status: z.literal("user_confirmed"), confirmedOn: z.string().date(),
    statement: z.string().min(1), basis: z.literal("user_statement"),
  }).strict(),
  clarification: z.object({
    zeroMeaning: z.literal("unconfirmed"), zeroHypothesis: z.string().min(1),
    naMeaning: z.null(), tnsMeaning: z.null(), numericUnit: z.null(),
    academicTerm: z.null(), periodStart: z.null(), periodEnd: z.null(),
  }).strict(),
}).strict();

const namedRowsSchema = z.array(z.object({
  id: z.string(), studentId: z.string().uuid(), displayId: z.string(), sourceId: z.string(),
  semester: z.number(), section: z.string(), sourceRow: z.number(),
  studentName: z.string().min(1), srn: z.string().min(1),
}));

/** Permission to use a source does not establish its units, dates or status meanings. */
export function buildCollegeAttendanceReview(bundle: unknown, identities: unknown, context: unknown) {
  const data = collegeAttendanceSchema.parse(bundle);
  const names = namedRowsSchema.parse(identities);
  const confirmed = collegeSourceContextSchema.parse(context);
  if (confirmed.datasetId !== data.datasetId) throw new Error("Source confirmation belongs to a different dataset");
  const byEnrollment = new Map(names.map(row => [row.id, row]));
  if (byEnrollment.size !== names.length || names.length !== data.enrollments.length) throw new Error("Named rows do not match the import");
  const studentSrns = new Map<string, string>(), srnStudents = new Map<string, string>();
  for (const row of data.enrollments) {
    const named = byEnrollment.get(row.id);
    if (!named || named.studentId !== row.studentId || named.sourceId !== row.sourceId ||
      named.semester !== row.semester || named.section !== row.section || named.sourceRow !== row.sourceRow || named.displayId !== row.displayId) {
      throw new Error("Named row belongs to a different student or source row");
    }
    if ((studentSrns.has(row.studentId) && studentSrns.get(row.studentId) !== named.srn) ||
        (srnStudents.has(named.srn) && srnStudents.get(named.srn) !== row.studentId)) throw new Error("Conflicting student identity mapping");
    studentSrns.set(row.studentId, named.srn); srnStudents.set(named.srn, row.studentId);
  }
  return {
    datasetId: data.datasetId, summary: data.summary,
    permission: { status: confirmed.permission.status, confirmedOn: confirmed.permission.confirmedOn, basis: confirmed.permission.basis },
    fullAgentReviewReady: false as const, overallRiskScore: null,
    sources: data.sources.map(source => ({
      id: source.id, filename: source.filename, institution: source.institution, department: source.department,
      semester: source.semester, section: source.section, students: source.studentRows,
      reportedDateRange: source.reportedDateRange, courseColumns: source.courseColumns,
    })),
    students: [...studentSrns].map(([studentId, srn]) => {
      const rows = data.enrollments.filter(row => row.studentId === studentId);
      const first = byEnrollment.get(rows[0]!.id)!;
      return {
        id: studentId, displayId: first.displayId, name: first.studentName, srn,
        reports: rows.map(row => ({
          sourceId: row.sourceId, semester: row.semester, section: row.section, sourceRow: row.sourceRow,
          nameAsRecorded: byEnrollment.get(row.id)!.studentName,
          courses: data.observations.filter(cell => cell.enrollmentId === row.id).map(cell => ({
            course: cell.courseLabel, field: "Recorded attendance", value: cell.rawValue, kind: cell.kind, cell: cell.sourceCell,
          })),
        })),
      };
    }),
  };
}
export type CollegeAttendanceReview = Omit<ReturnType<typeof buildCollegeAttendanceReview>, "sources"> & {
  recordedValues?: number;
  sources: Array<ReturnType<typeof buildCollegeAttendanceReview>["sources"][number] & { sheet?: string; reportType?: string; legend?: Array<{course: string; title: string; credits: number}> }>;
};

export function attachCollegeCie(review: CollegeAttendanceReview, input: unknown, identityMap: unknown): CollegeAttendanceReview {
  const cie = validateCieIdentities(input, identityMap), source = cie.source;
  if (review.sources.some(s => s.id === source.id)) throw new Error("CIE source already attached");
  const result = structuredClone(review);
  result.sources.push({ id: source.id, filename: source.filename, institution: source.institution, department: source.department,
    semester: source.semester, section: source.section, students: cie.rows.length, reportedDateRange: "Not supplied",
    courseColumns: source.legend.map(c => c.course), sheet: source.sheet, reportType: "Final CIE & attendance", legend: source.legend });
  for (const row of cie.rows) {
    let student = result.students.find(s => s.id === row.studentId);
    if (student && student.srn !== row.srn) throw new Error("CIE and attendance identities disagree");
    if (!student) { student = { id: row.studentId, displayId: row.displayId, srn: row.srn, name: row.studentName, reports: [] }; result.students.push(student); }
    student.reports.push({ sourceId: source.id, semester: source.semester, section: source.section, sourceRow: row.sourceRow,
      nameAsRecorded: row.studentName, courses: row.cells.map(c => ({course: c.course, field: c.field, value: c.rawValue, kind: c.kind, cell: c.sourceCell})) });
  }
  result.recordedValues = review.summary.attendanceCells + cie.summary.recordedCells;
  return result;
}

export async function readPrivateImportFile(privateRoot: string, path: string) {
  const root = await realpath(privateRoot), resolved = await realpath(path);
  const location = relative(root, resolved);
  if (location.startsWith("..") || isAbsolute(location)) throw new Error("Import files must stay inside runtime/college-attendance");
  return JSON.parse(await readFile(resolved, "utf8")) as unknown;
}

export async function loadCollegeAttendanceReview(privateRoot: string, bundlePath: string) {
  const folder = dirname(await realpath(bundlePath));
  const [bundle, identities, context] = await Promise.all([
    readPrivateImportFile(privateRoot, bundlePath),
    readPrivateImportFile(privateRoot, resolve(folder, "private-student-records.json")),
    readPrivateImportFile(privateRoot, resolve(folder, "source-context.json")),
  ]);
  const review = buildCollegeAttendanceReview(bundle, identities, context);
  let cie: unknown;
  try { cie = await readPrivateImportFile(privateRoot, resolve(folder, "cie.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return review; throw error; }
  const map = await readPrivateImportFile(privateRoot, resolve(folder, "private-identity-map.json"));
  const cieContext = collegeSourceContextSchema.parse(await readPrivateImportFile(privateRoot, resolve(folder, "cie-source-context.json")));
  if (cieContext.datasetId !== validateCieIdentities(cie, map).source.id) throw new Error("CIE source confirmation belongs to a different source");
  return attachCollegeCie(review, cie, map);
}
