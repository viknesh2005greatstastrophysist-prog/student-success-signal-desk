import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { projectCollegeSources, validateCollegeAccess } from "../lib/college-access";
import { requireSyntheticInstitution } from "../lib/security";
import { buildCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { collegeDatasetHash } from "../lib/chapter11/college-pilot-engine";
import { fixture } from "./fixtures/college-attendance";
import { identityMode } from "../../auth-server/lib/identity-mode";

function inputs(role: ActorContext["role"]) {
  const bundle = fixture(), row = bundle.enrollments[0]!;
  const review = buildCollegeAttendanceReview(bundle, [{ ...row, studentName: "Fictional Account Student", srn: "TEST001" }], {
    schemaVersion: "aura.college-source-context.v1", datasetId: bundle.datasetId,
    permission: { status: "user_confirmed", confirmedOn: "2026-10-12", statement: "Fictional local test", basis: "user_statement" },
    clarification: { zeroMeaning: "unconfirmed", zeroHypothesis: "Unknown", naMeaning: null, tnsMeaning: null, numericUnit: null, academicTerm: null, periodStart: null, periodEnd: null },
  });
  review.students[0]!.reports[0]!.courses.push({ course: "TEST101", field: "CIE", value: 42, kind: "number", cell: "I8" });
  const peer = structuredClone(review.students[0]!); peer.id = randomUUID(); peer.name = "Other Fictional Student"; peer.srn = "TEST002"; review.students.push(peer);
  const departmentId = randomUUID(), personId = randomUUID(), datasetHash = collegeDatasetHash(review);
  const actor: ActorContext = { subject: "TEST-VERIFIED-OIDC-SUBJECT", role, personId, departmentId, ...(role === "student" ? { studentId: row.studentId } : {}) };
  const access = { schemaVersion: "aura.verified-college-access.v1", datasetHash, dataAccessApproved: true, approvedBy: "Fictional Authority", approvalReference: "TEST-ONLY-NOT-REAL-APPROVAL",
    sourceDepartments: [{ sourceId: review.sources[0]!.id, departmentId }],
    users: [{ subject: actor.subject, personId, role, studentIds: [row.studentId], departmentId, fieldGroups: ["attendance", "marks"], identityVerified: true,
      mappingVerifiedBy: "Fictional Authority", mappingReference: "TEST-ONLY", parentRelationshipVerified: role === "parent" }] };
  return { review, actor, access, datasetHash, studentId: row.studentId };
}

test("verified student scope exposes one source identity and never a peer or computed risk", () => {
  const { review, actor, access, datasetHash, studentId } = inputs("student");
  const view = projectCollegeSources(actor, review, access, datasetHash, { studentIds: [studentId] });
  assert.equal(view.students.length, 1); assert.equal(view.students[0]!.id, studentId); assert.equal(view.riskScore, null);
  assert.throws(() => projectCollegeSources({ ...actor, studentId: randomUUID() }, review, access, datasetHash, { studentIds: [studentId] }), /identity differs/);
  assert.throws(() => projectCollegeSources({ ...actor, personId: randomUUID() }, review, access, datasetHash, { studentIds: [studentId] }), /No verified/);
});

test("parent field grants and mentor assignments are checked live, including revocation", () => {
  const { review, actor, access, datasetHash, studentId } = inputs("parent");
  const view = projectCollegeSources(actor, review, access, datasetHash, { studentIds: [studentId], perStudentFields: { [studentId]: ["attendance"] } });
  assert.ok(view.students[0]!.reports[0]!.cells.every(c => !c.field.startsWith("CIE")));
  assert.equal(projectCollegeSources(actor, review, access, datasetHash, { studentIds: [], perStudentFields: {} }).students.length, 0);
  assert.throws(() => projectCollegeSources(actor, review, access, datasetHash, { studentIds: [studentId] }), /Current assignment/);
  const teacher = inputs("faculty");
  assert.equal(projectCollegeSources(teacher.actor, teacher.review, teacher.access, teacher.datasetHash, { studentIds: [] }).students.length, 0);
});

test("department mismatch is rejected and governance sees aggregate readiness only", () => {
  const hod = inputs("hod");
  assert.throws(() => projectCollegeSources({ ...hod.actor, departmentId: randomUUID() }, hod.review, hod.access, hod.datasetHash, { studentIds: hod.review.students.map(s => s.id) }), /department differs/);
  const governance = inputs("governance");
  const view = projectCollegeSources(governance.actor, governance.review, governance.access, governance.datasetHash, { studentIds: governance.review.students.map(s => s.id) });
  assert.deepEqual(view.students, []); assert.deepEqual(view.sources, []); assert.equal(view.counts.students, 2);
  assert.ok(!JSON.stringify(view).includes("TEST001")); assert.ok(!JSON.stringify(view).includes("Fictional Account Student"));
});

test("demo identities, incomplete mappings and wrong datasets cannot activate real source access", () => {
  const { review, access, datasetHash } = inputs("student");
  const demo = structuredClone(access); demo.users[0]!.subject = "aura-demo-student";
  assert.throws(() => validateCollegeAccess(demo, review, datasetHash), /Demonstration identities/);
  assert.throws(() => validateCollegeAccess({ ...access, sourceDepartments: [] }, review, datasetHash));
  assert.throws(() => validateCollegeAccess(access, review, "a".repeat(64)), /different college dataset/);
  assert.throws(() => validateCollegeAccess({ ...access, dataAccessApproved: null }, review, datasetHash));
});

test("content or identity-map edits create a distinct dataset fingerprint", () => {
  const { review, datasetHash } = inputs("student");
  review.students[0]!.reports[0]!.courses[0]!.value = 1; assert.notEqual(collegeDatasetHash(review), datasetHash);
  const hash = collegeDatasetHash(review); review.students[0]!.srn = "DIFFERENT"; assert.notEqual(collegeDatasetHash(review), hash);
});

test("institutional mode rejects demo operations and invalid identity modes fail closed", () => {
  assert.throws(() => requireSyntheticInstitution({ CORE_IDENTITY_REALM: "institutional" }), /disabled/);
  requireSyntheticInstitution({ CORE_IDENTITY_REALM: "demo" });
  assert.equal(identityMode({ AURA_IDENTITY_MODE: "institutional" }), "institutional");
  assert.equal(identityMode({}), "demo"); assert.throws(() => identityMode({ AURA_IDENTITY_MODE: "misspelled" }));
});
