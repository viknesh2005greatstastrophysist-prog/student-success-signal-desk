import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  acceptanceChecks,
  compose,
  demoPolicy,
  formatSkill,
  riskAnalysis,
  sourceNames,
  type Evidence,
} from "../lib/chapter11/engine";
const id = randomUUID();
const evidence = Object.fromEntries(
  sourceNames.map((source) => [
    source,
    {
      source,
      studentId: id,
      recordId: source,
      observedAt: new Date().toISOString(),
      semester: "TEST",
      state: "present",
      synthetic: true,
      values:
        source === "academic"
          ? { attendancePct: 50, markPct: 50 }
          : source === "lms"
            ? { inactivityDays: 9, overdueAssignments: 2 }
            : source === "internship"
              ? { missedMilestones: 1 }
              : { missedActivities: 1 },
    },
  ]),
) as unknown as Evidence;
const risk = riskAnalysis(evidence, demoPolicy),
  baseline = formatSkill(risk, "academic");
const checkNames = [
  "alerts_cite_triggers",
  "thresholds_faculty_set",
  "advisor_review_required",
  "privacy_scope_enforced",
] as const;
type CheckName = (typeof checkNames)[number];
// The failure code each injected fault must raise (and the one check it must flip).
const faultCode: Record<CheckName, string> = {
  alerts_cite_triggers: "MISSING_TRIGGER_COVERAGE",
  thresholds_faculty_set: "THRESHOLDS_NOT_FACULTY_SET",
  advisor_review_required: "ADVISOR_REVIEW_REQUIRED",
  privacy_scope_enforced: "PRIVACY_SCOPE_MISMATCH",
};
const cleanGuard = { version: demoPolicy.version, facultyApproved: true };
const inject = (name: CheckName | null) => {
  const e = structuredClone(evidence),
    packet = structuredClone(baseline),
    guard = { ...cleanGuard };
  if (name === "alerts_cite_triggers") packet.citations.shift();
  if (name === "thresholds_faculty_set") guard.facultyApproved = false;
  if (name === "advisor_review_required") packet.actions[0]!.owner = "student";
  if (name === "privacy_scope_enforced") e.placement.studentId = randomUUID();
  return { e, packet, guard };
};
const composeWith = (
  e: Evidence,
  guard: typeof cleanGuard,
  generate: () => Promise<typeof baseline>,
) =>
  compose(
    {
      evidence: e,
      risk,
      baseline,
      domain: "academic",
      references: [],
      policyGuard: guard,
    },
    { modelId: "persistent-fault-fixture", generate },
  );
test("Positive control: a clean packet passes every check without repair", async () => {
  const { e, packet, guard } = inject(null);
  const report = acceptanceChecks(packet, e, risk, "academic", guard);
  assert.equal(report.valid, true);
  assert.deepEqual(report.failures, []);
  for (const name of checkNames) assert.equal(report.checks[name], true, name);
  let calls = 0;
  const result = await composeWith(e, guard, async () => {
    calls++;
    return packet;
  });
  assert.equal(calls, 1);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.escalated, false);
  assert.equal(result.validation.repairs.length, 0);
});
for (const name of checkNames) {
  test(`Persistent injected ${name} fault escalates after bounded repair`, async () => {
    const { e, packet, guard } = inject(name);
    const report = acceptanceChecks(packet, e, risk, "academic", guard);
    assert.equal(report.valid, false);
    assert.equal(report.checks[name], false);
    // Only the injected fault trips: every other check stays true.
    for (const other of checkNames.filter((n) => n !== name))
      assert.equal(
        report.checks[other],
        true,
        `${name} must not flip ${other}`,
      );
    assert.ok(
      report.failures.some((f) => f.code === faultCode[name]),
      `${name} must raise ${faultCode[name]}, got ${report.failures.map((f) => f.code)}`,
    );
    let calls = 0;
    const result = await composeWith(e, guard, async () => {
      calls++;
      return packet;
    });
    assert.equal(calls, 3);
    assert.equal(result.validation.repairs.length, 2);
    assert.equal(result.validation.valid, false);
    assert.equal(result.validation.escalated, true);
    assert.equal(result.validation.checks[name], false);
    assert.ok(
      result.validation.failures.some((f) => f.code === faultCode[name]),
    );
    assert.equal(
      result.validation.selection.selected,
      "template-offered-for-human-review",
    );
  });
}
