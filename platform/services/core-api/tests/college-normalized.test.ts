import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { normalizedCollegeBatchSchema, readApprovedCollegeSource } from "../lib/college-normalized";
import { demoPolicy, sourceNames, validateEvidence, type Evidence } from "../lib/chapter11/engine";

function batch() {
  const studentId = randomUUID();
  return { schemaVersion: "aura.approved-college-normalization.v1", packageHash: "a".repeat(64), academicTerm: "OFFICIAL-TERM-TEST",
    periodStart: "2026-10-01", periodEnd: "2026-10-12", sourceDefinitionsConfirmed: true,
    mentorApprovals: [{ studentId, mentorId: randomUUID(), approvalReference: "FICTIONAL TEST APPROVAL" }], approvalReference: "FICTIONAL TEST APPROVAL", normalizationRules: "Fictional explicit test-only normalization; no actual records",
    records: sourceNames.map(source => ({ source, studentId, recordId: `TEST-${source}`, observedAt: "2026-10-12T00:00:00.000Z", semester: "OFFICIAL-TERM-TEST", state: "present", synthetic: false,
      values: source === "academic" ? { attendancePct: 79, markPct: 80 } : source === "lms" ? { inactivityDays: 2, overdueAssignments: 0 } : source === "internship" ? { missedMilestones: 0 } : { missedActivities: 0 } })) };
}

test("approved four-source evidence uses its actual declared term, never a hard-coded demo semester", () => {
  const result = normalizedCollegeBatchSchema.parse(batch());
  const evidence = Object.fromEntries(result.records.map(r => [r.source, r])) as Evidence;
  validateEvidence(evidence, result.records[0]!.studentId, demoPolicy, "2026-10-12T01:00:00.000Z", result.academicTerm);
  assert.ok(result.records.every(r => r.synthetic === false));
  assert.throws(() => validateEvidence(evidence, result.records[0]!.studentId, demoPolicy, "2026-10-12T01:00:00.000Z", "2026-ODD"), /scope mismatch/);
});

test("unknown dates, absent LMS, unsupported percentages and synthetic substitutions cannot activate normalization", () => {
  const original = batch();
  const missing = structuredClone(original); missing.records.pop(); assert.throws(() => normalizedCollegeBatchSchema.parse(missing));
  const date = structuredClone(original); date.records[0]!.observedAt = "unknown"; assert.throws(() => normalizedCollegeBatchSchema.parse(date));
  const synthetic = structuredClone(original); synthetic.records[0]!.synthetic = true; assert.throws(() => normalizedCollegeBatchSchema.parse(synthetic));
  const number = structuredClone(original); number.records[0]!.values.attendancePct = 101; assert.throws(() => normalizedCollegeBatchSchema.parse(number));
  const duplicate = structuredClone(original); duplicate.records.push({ ...duplicate.records[0]! }); assert.throws(() => normalizedCollegeBatchSchema.parse(duplicate));
  const unknown = structuredClone(original); unknown.academicTerm = "unknown"; assert.throws(() => normalizedCollegeBatchSchema.parse(unknown));
  const unconfirmed = structuredClone(original); unconfirmed.sourceDefinitionsConfirmed = false; assert.throws(() => normalizedCollegeBatchSchema.parse(unconfirmed));
  const extra = structuredClone(original); Object.assign(extra.records[0]!.values, { studentName: "Private name" }); assert.throws(() => normalizedCollegeBatchSchema.parse(extra));
  const noApproval = structuredClone(original); noApproval.mentorApprovals = []; assert.throws(() => normalizedCollegeBatchSchema.parse(noApproval));
  const unrelated = structuredClone(original); unrelated.mentorApprovals[0]!.studentId = randomUUID(); assert.throws(() => normalizedCollegeBatchSchema.parse(unrelated));
});

test("the current real-data connector blocks before database access when no approved normalization is configured", async () => {
  const previous = process.env.COLLEGE_NORMALIZATION_BATCH_HASH; delete process.env.COLLEGE_NORMALIZATION_BATCH_HASH;
  try { await assert.rejects(readApprovedCollegeSource({ subject: "TEST", role: "faculty", personId: randomUUID(), departmentId: randomUUID() }, randomUUID(), "academic"), /normalization has not been approved/); }
  finally { if (previous === undefined) delete process.env.COLLEGE_NORMALIZATION_BATCH_HASH; else process.env.COLLEGE_NORMALIZATION_BATCH_HASH = previous; }
});
