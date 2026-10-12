import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const sourceSchema = z.object({
  id: hash, filename: z.string().min(1), sha256: hash, sheet: z.literal("Full_Attendance"),
  institution: z.string().min(1), department: z.string().min(1), semester: count.min(1),
  section: z.string().min(1), reportedDateRange: z.string(),
  periodStart: z.null(), periodEnd: z.null(), academicTerm: z.null(),
  numericUnit: z.literal("unconfirmed_0_to_100"),
  statusDefinitions: z.object({ NA: z.null(), TNS: z.null() }).strict(),
  parserRecoveryRequired: z.boolean(), independentReadersAgree: z.literal(true),
  verifiedCells: count.min(1), courseColumns: z.array(z.string().min(1)).min(1), studentRows: count,
}).strict();
const enrollmentSchema = z.object({
  id: hash, studentId: z.string().uuid(), displayId: z.string().regex(/^Student \d+$/),
  sourceId: hash, semester: count.min(1), section: z.string().min(1), sourceRow: count.min(8),
}).strict();
const observationSchema = z.object({
  id: hash, studentId: z.string().uuid(), enrollmentId: hash, sourceId: hash,
  sourceCell: z.string().regex(/^[A-Z]+[1-9]\d*$/), courseLabel: z.string().min(1), courseKey: z.string().min(1),
  semester: count.min(1), section: z.string().min(1),
  kind: z.enum(["number", "source_status", "blank"]),
  rawValue: z.union([z.string(), z.number().finite()]), numericValue: z.number().min(0).max(100).nullable(),
  sourceStatus: z.enum(["NA", "TNS"]).nullable(),
  attendancePct: z.null(), attendedClasses: z.null(), heldClasses: z.null(), synthetic: z.literal(false),
}).strict();

/** Imported summaries retain their own meaning. They are not dated attendance sessions. */
export const collegeAttendanceSchema = z.object({
  schemaVersion: z.literal("aura.college-attendance.v1"), datasetId: hash,
  importedAt: z.string().datetime({ offset: true }),
  sourceType: z.literal("user_supplied_college_export"),
  privacy: z.literal("private_local_pseudonymized"), synthetic: z.literal(false),
  summary: z.object({
    sourceFiles: count, studentRows: count, uniqueStudents: count, studentsInMultipleReports: count,
    attendanceCells: count, numericCells: count, zeroCells: count, naCells: count, tnsCells: count,
    blankCells: count, verifiedSourceCells: count, parserRecoveryFiles: count,
  }).strict(),
  sources: z.array(sourceSchema).min(1), enrollments: z.array(enrollmentSchema).min(1),
  observations: z.array(observationSchema).min(1),
}).strict().superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const sources = new Map(data.sources.map(s => [s.id, s]));
  const enrollments = new Map(data.enrollments.map(e => [e.id, e]));
  if (sources.size !== data.sources.length || enrollments.size !== data.enrollments.length || new Set(data.observations.map(o => o.id)).size !== data.observations.length) fail("Duplicate source, enrollment or observation ID");
  const studentCounts = new Map<string, number>();
  const sourceStudents = new Set<string>();
  const cells = new Set<string>();
  const sourceCounts = new Map<string, number>();
  for (const source of data.sources) {
    if (source.id !== source.sha256) fail("Source ID does not match its file hash");
    if (new Set(source.courseColumns.map(c => c.toUpperCase())).size !== source.courseColumns.length) fail("Duplicate course columns");
  }
  for (const row of data.enrollments) {
    const source = sources.get(row.sourceId);
    if (!source || row.semester !== source.semester || row.section !== source.section) fail("Enrollment scope does not match its source");
    const key = `${row.sourceId}:${row.studentId}`;
    if (sourceStudents.has(key)) fail("Duplicate student in the same source");
    sourceStudents.add(key);
    studentCounts.set(row.studentId, (studentCounts.get(row.studentId) ?? 0) + 1);
    sourceCounts.set(row.sourceId, (sourceCounts.get(row.sourceId) ?? 0) + 1);
  }
  const enrollmentCells = new Map<string, Set<string>>();
  for (const cell of data.observations) {
    const source = sources.get(cell.sourceId), row = enrollments.get(cell.enrollmentId);
    if (!row || !source || row.sourceId !== cell.sourceId || row.studentId !== cell.studentId || row.semester !== cell.semester || row.section !== cell.section) fail("Observation scope does not match its student/source");
    const match = /^([A-Z]+)(\d+)$/.exec(cell.sourceCell);
    if (!match) { fail("Invalid source cell address"); continue; }
    const column = [...match[1]!].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    if (Number(match[2]) !== row?.sourceRow || source?.courseColumns[column - 4] !== cell.courseLabel || cell.courseKey !== cell.courseLabel.toUpperCase()) fail("Observation cell does not match its source row/course column");
    const key = `${cell.sourceId}:${cell.sourceCell}`;
    if (cells.has(key)) fail("Duplicate source cell");
    cells.add(key);
    const labels = enrollmentCells.get(cell.enrollmentId) ?? new Set<string>();
    if (labels.has(cell.courseKey)) fail("Duplicate course observation for this enrollment");
    labels.add(cell.courseKey); enrollmentCells.set(cell.enrollmentId, labels);
    if (cell.kind === "number" && (typeof cell.rawValue !== "number" || cell.rawValue !== cell.numericValue || cell.sourceStatus !== null)) fail("Numeric attendance must preserve the raw number, including zero");
    if (cell.kind === "source_status" && (typeof cell.rawValue !== "string" || !cell.sourceStatus || cell.rawValue.trim().toUpperCase() !== cell.sourceStatus || cell.numericValue !== null)) fail("NA/TNS cannot be converted to a numeric attendance value");
    if (cell.kind === "blank" && (cell.rawValue !== "" || cell.numericValue !== null || cell.sourceStatus !== null)) fail("Blank attendance cannot become a zero");
  }
  for (const row of data.enrollments) if (enrollmentCells.get(row.id)?.size !== sources.get(row.sourceId)?.courseColumns.length) fail("Missing course cells for a student row");
  for (const source of data.sources) if ((sourceCounts.get(source.id) ?? 0) !== source.studentRows) fail("Source student count mismatch");
  const numeric = data.observations.filter(o => o.kind === "number");
  const actual = {
    sourceFiles: data.sources.length, studentRows: data.enrollments.length, uniqueStudents: studentCounts.size,
    studentsInMultipleReports: [...studentCounts.values()].filter(n => n > 1).length,
    attendanceCells: data.observations.length, numericCells: numeric.length,
    zeroCells: numeric.filter(o => o.numericValue === 0).length,
    naCells: data.observations.filter(o => o.sourceStatus === "NA").length,
    tnsCells: data.observations.filter(o => o.sourceStatus === "TNS").length,
    blankCells: data.observations.filter(o => o.kind === "blank").length,
    verifiedSourceCells: data.sources.reduce((n,s) => n+s.verifiedCells,0),
    parserRecoveryFiles: data.sources.filter(s => s.parserRecoveryRequired).length,
  };
  for (const field of Object.keys(actual) as Array<keyof typeof actual>) if (data.summary[field] !== actual[field]) fail(`Import summary mismatch: ${field}`);
});
export type CollegeAttendance = z.infer<typeof collegeAttendanceSchema>;

/** The data-quality step runs locally before these records can feed a mentor review. */
export function reviewCollegeAttendance(input: unknown) {
  const data = collegeAttendanceSchema.parse(input);
  return {
    datasetId: data.datasetId, status: "source_clarification_needed" as const,
    summary: data.summary, synthetic: false, fullAgentReviewReady: false,
    overallRiskScore: null, mentorAssignment: null,
    missingInputs: ["academic term and reporting dates", "numeric units and zero semantics", "NA and TNS definitions", "mentor assignments", "marks", "LMS activity", "internship and placement evidence or confirmed non-applicability"],
    sources: data.sources.map(source => ({
      sourceId: source.id, filename: source.filename, semester: source.semester, section: source.section,
      students: source.studentRows, reportedDateRange: source.reportedDateRange,
      collectionDateIsReportingDate: false, independentReadersAgree: source.independentReadersAgree,
    })),
    students: [...new Set(data.enrollments.map(e => e.studentId))].map(studentId => ({
      studentId, displayId: data.enrollments.find(e => e.studentId === studentId)!.displayId,
      records: data.observations.filter(o => o.studentId === studentId),
      overallAttendancePct: null, overallRiskScore: null,
    })),
  };
}
