import { z } from "zod";

const fields = z.enum(["CIE", "CIE Theory", "CIE Lab", "Attendance", "Attendance Theory", "Attendance Lab", "Eligible/not eligible"]);
export const collegeCieSchema = z.object({
  schemaVersion: z.literal("aura.college-cie.v1"),
  source: z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/), filename: z.string().min(1), sheet: z.literal("CIE_ATTENDANCE"),
    institution: z.string().min(1), department: z.string().min(1), semester: z.number().int().positive(), section: z.string().min(1),
    periodStart: z.null(), periodEnd: z.null(), academicTerm: z.null(), independentReadersAgree: z.literal(true),
    verifiedCells: z.number().int().positive(), parserRecoveryRequired: z.boolean(),
    columns: z.array(z.object({ column: z.number().int().min(3), course: z.string().min(1), field: fields }).strict()).min(1),
    legend: z.array(z.object({ course: z.string().min(1), title: z.string().min(1), credits: z.number().positive(), sourceRow: z.number().int().positive() }).strict()).min(1),
    footer: z.array(z.object({ value: z.string(), sourceCell: z.string().regex(/^A[1-9]\d*$/) }).strict()),
  }).strict(),
  rows: z.array(z.object({
    studentId: z.string().uuid(), displayId: z.string().regex(/^Student \d+$/), srn: z.string().regex(/^[A-Z0-9]{5,40}$/),
    studentName: z.string().min(1), sourceRow: z.number().int().min(8),
    cells: z.array(z.object({ course: z.string().min(1), field: fields, sourceCell: z.string().regex(/^[A-Z]+[1-9]\d*$/),
      rawValue: z.union([z.string(), z.number().finite().nonnegative()]), kind: z.enum(["number", "source_status", "blank"]),
    }).strict()).min(1),
  }).strict()).min(1),
  summary: z.object({ studentRows: z.number().int().nonnegative(), recordedCells: z.number().int().nonnegative(),
    kinds: z.partialRecord(z.enum(["number", "source_status", "blank"]), z.number().int().nonnegative()),
  }).strict(),
}).strict().superRefine((data, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const source = data.source, keys = source.columns.map(c => `${c.course}:${c.field}`);
  if (new Set(keys).size !== keys.length || source.columns.some((c, index) => c.column !== index + 3)) fail("CIE column coverage mismatch");
  const courses = new Set(source.columns.map(c => c.course));
  if (new Set(source.legend.map(c => c.course)).size !== source.legend.length || source.legend.length !== courses.size || source.legend.some(c => !courses.has(c.course))) fail("CIE course legend mismatch");
  for (const field of ["studentId", "srn", "sourceRow"] as const) if (new Set(data.rows.map(r => r[field])).size !== data.rows.length) fail("Duplicate CIE student or source row");
  const kinds = { number: 0, source_status: 0, blank: 0 };
  for (const row of data.rows) {
    if (row.cells.length !== source.columns.length) fail("Missing CIE course fields");
    row.cells.forEach((cell, index) => {
      const column = source.columns[index];
      const match = /^([A-Z]+)(\d+)$/.exec(cell.sourceCell);
      if (!match) { fail("Invalid CIE source cell"); return; }
      const position = [...match[1]!].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (!column || cell.course !== column.course || cell.field !== column.field || position !== column.column || Number(match[2]) !== row.sourceRow) fail("CIE cell scope mismatch");
      if (cell.kind === "number" && (typeof cell.rawValue !== "number" || cell.field === "Eligible/not eligible" || (cell.field.startsWith("Attendance") && cell.rawValue > 100))) fail("Invalid CIE numeric value");
      if (cell.kind === "blank" && cell.rawValue !== "") fail("Blank CIE value must remain blank");
      if (cell.kind === "source_status" && !(cell.rawValue === "-" || (cell.field === "Eligible/not eligible" && (cell.rawValue === "Yes" || cell.rawValue === "No")))) fail("Unknown CIE source status");
      kinds[cell.kind]++;
    });
  }
  if (data.summary.studentRows !== data.rows.length || data.summary.recordedCells !== Object.values(kinds).reduce((n, c) => n + c, 0) || Object.entries(kinds).some(([key, count]) => (data.summary.kinds[key as keyof typeof kinds] ?? 0) !== count)) fail("CIE summary mismatch");
});

export function validateCieIdentities(input: unknown, identityMap: unknown) {
  const data = collegeCieSchema.parse(input);
  const identities = z.record(z.string(), z.object({ studentId: z.string().uuid(), displayId: z.string() }).strict()).parse(identityMap);
  for (const row of data.rows) {
    const identity = identities[row.srn];
    if (!identity || identity.studentId !== row.studentId || identity.displayId !== row.displayId) throw new Error("CIE identity does not match the private SRN map");
  }
  return data;
}
