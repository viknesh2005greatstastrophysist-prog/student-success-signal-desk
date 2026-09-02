import assert from "node:assert/strict";
import test from "node:test";

import { critiqueBrief, type MentorBrief } from "../lib/aura/agent";
import { resolveView, type StoredProfile } from "../lib/aura/authz";

const validBrief: MentorBrief = {
  title: "Synthetic mentor review brief",
  summary: "Validated records contain an attendance item for faculty review; no outcome is predicted.",
  evidenceClaims: [{ text: "Attendance is below the fictional policy line.", evidenceRefs: ["EVID-SYN-0002-ACADEMIC"] }],
  supportRanking: [{ supportCode: "SUP-MENTOR-CHECKIN", rationale: "A mentor check-in is eligible; the mentor decides whether it is appropriate." }],
  uncertainties: ["The reason for the observed attendance is unknown."],
};

test("critic accepts a cited brief using only eligible support", () => {
  assert.deepEqual(
    critiqueBrief(validBrief, new Set(["EVID-SYN-0002-ACADEMIC"]), new Set(["SUP-MENTOR-CHECKIN"])),
    [],
  );
});

test("critic rejects predictive language, invented evidence, and ineligible support", () => {
  const invalid: MentorBrief = {
    ...validBrief,
    summary: "The student will fail.",
    evidenceClaims: [{ text: "An unsupported claim.", evidenceRefs: ["EVID-INVENTED"] }],
    supportRanking: [{ supportCode: "SUP-NOT-APPROVED", rationale: "This unsupported action should happen." }],
  };
  assert.deepEqual(
    critiqueBrief(invalid, new Set(["EVID-SYN-0002-ACADEMIC"]), new Set(["SUP-MENTOR-CHECKIN"])),
    ["PROHIBITED_OR_PREDICTIVE_LANGUAGE", "UNKNOWN_EVIDENCE_REF:EVID-INVENTED", "INELIGIBLE_SUPPORT:SUP-NOT-APPROVED"],
  );
});

test("a non-operations account cannot select another browser perspective", () => {
  const profile: StoredProfile = {
    clerkUserId: "user_test",
    role: "STUDENT",
    displayName: "Synthetic Student Account",
    studentRef: "SYN-0002",
    canPreview: false,
  };
  const view = resolveView(profile, "operations");
  assert.equal(view.identity.role, "STUDENT");
  assert.equal(view.identity.studentRef, "SYN-0002");
  assert.equal(view.available.length, 1);
});

test("operations preview does not change the authenticated role", () => {
  const profile: StoredProfile = {
    clerkUserId: "user_ops",
    role: "OPERATIONS",
    displayName: "AURA Operations Owner",
    canPreview: true,
  };
  const view = resolveView(profile, "mentor-01");
  assert.equal(view.identity.role, "MENTOR");
  assert.equal(profile.role, "OPERATIONS");
});
