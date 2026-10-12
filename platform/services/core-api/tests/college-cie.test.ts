import assert from "node:assert/strict";
import test from "node:test";
import { collegeCieSchema, validateCieIdentities } from "../lib/chapter11/college-cie";
import { attachCollegeCie, buildCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { fixture } from "./fixtures/college-attendance";

function inputs() {
  const bundle = fixture(), row = bundle.enrollments[0]!;
  const identities = { TEST001: { studentId: row.studentId, displayId: row.displayId } };
  const cie = { schemaVersion: "aura.college-cie.v1", source: { id: "a".repeat(64), filename: "FICTIONAL_CIE.xls", sheet: "CIE_ATTENDANCE",
    institution: "Fictional College", department: "TEST", semester: 8, section: "Section A", periodStart: null, periodEnd: null, academicTerm: null,
    independentReadersAgree: true, verifiedCells: 48, parserRecoveryRequired: false,
    columns: [{ column: 3, course: "TEST101", field: "CIE" }, { column: 4, course: "TEST101", field: "Attendance" }, { column: 5, course: "TEST101", field: "Eligible/not eligible" }],
    legend: [{ course: "TEST101", title: "Fictional Subject", credits: 3, sourceRow: 11 }], footer: [], },
    rows: [{ ...identities.TEST001, srn: "TEST001", studentName: "Fictional Student", sourceRow: 8,
      cells: [{ course: "TEST101", field: "CIE", sourceCell: "D8", rawValue: 0, kind: "number" },
        { course: "TEST101", field: "Attendance", sourceCell: "E8", rawValue: "-", kind: "source_status" },
        { course: "TEST101", field: "Eligible/not eligible", sourceCell: "F8", rawValue: "No", kind: "source_status" }] }],
    summary: { studentRows: 1, recordedCells: 3, kinds: { number: 1, source_status: 2 } } };
  const context = { schemaVersion: "aura.college-source-context.v1", datasetId: bundle.datasetId,
    permission: { status: "user_confirmed", confirmedOn: "2026-10-12", statement: "Local test use", basis: "user_statement" },
    clarification: { zeroMeaning: "unconfirmed", zeroHypothesis: "Unknown", naMeaning: null, tnsMeaning: null, numericUnit: null, academicTerm: null, periodStart: null, periodEnd: null } };
  const review = buildCollegeAttendanceReview(bundle, [{ ...row, studentName: "Fictional Student", srn: "TEST001" }], context);
  return { cie, identities, review };
}

test("CIE joins the same SRN without overwriting attendance or inventing scores", () => {
  const { cie, identities, review } = inputs();
  const result = attachCollegeCie(review, cie, identities);
  assert.equal(result.students.length, 1); assert.equal(result.sources.length, 2);
  assert.equal(result.students[0]!.reports.length, 2);
  assert.deepEqual(result.students[0]!.reports[1]!.courses.map(c => c.value), [0, "-", "No"]);
  assert.equal(result.recordedValues, 7); assert.equal(result.overallRiskScore, null); assert.equal(result.fullAgentReviewReady, false);
  assert.equal(review.sources.length, 1);
});

test("CIE validation rejects wrong identity, missing cells, misplaced citations and incorrect totals", () => {
  const { cie, identities } = inputs();
  assert.throws(() => validateCieIdentities(cie, { TEST001: { ...identities.TEST001, studentId: "22222222-2222-4222-8222-222222222222" } }), /private SRN/);
  const missing = structuredClone(cie); missing.rows[0]!.cells.pop(); assert.throws(() => collegeCieSchema.parse(missing));
  const misplaced = structuredClone(cie); misplaced.rows[0]!.cells[0]!.sourceCell = "D9"; assert.throws(() => collegeCieSchema.parse(misplaced));
  const address = structuredClone(cie); address.rows[0]!.cells[0]!.sourceCell = "invalid"; assert.throws(() => collegeCieSchema.parse(address), /Invalid CIE source cell|Invalid string/);
  const totals = structuredClone(cie); totals.summary.recordedCells++; assert.throws(() => collegeCieSchema.parse(totals));
  const status = structuredClone(cie); status.rows[0]!.cells[1]!.rawValue = "NA"; assert.throws(() => collegeCieSchema.parse(status));
});

test("CIE-only students remain separate and duplicate source attachments are rejected", () => {
  const { cie, identities, review } = inputs();
  cie.rows[0]!.srn = "TEST002"; cie.rows[0]!.studentId = "22222222-2222-4222-8222-222222222222"; cie.rows[0]!.displayId = "Student 002";
  const map = { ...identities, TEST002: { studentId: cie.rows[0]!.studentId, displayId: "Student 002" } };
  const result = attachCollegeCie(review, cie, map);
  assert.equal(result.students.length, 2);
  assert.throws(() => attachCollegeCie(result, cie, map), /already attached/);
});
