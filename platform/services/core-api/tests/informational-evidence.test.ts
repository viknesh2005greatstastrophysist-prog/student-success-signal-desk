/**
 * Informational evidence (spec conformance P2-5) changes nothing that is scored.
 * Database-free: the quiz scores, internship and placement detail the collectors attach
 * as `informational` leave the risk analysis, the evidence validator's verdict, the
 * policy contract and the remote-model payload exactly as they were, and an internship
 * organisation never reaches a remote model.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { InternshipRecord, PlacementRecord, QuizScore } from "@aura/contracts";
import {
  DataBlocked,
  INFORMATIONAL_NOTE,
  actions,
  demoPolicy,
  digest,
  formatSkill,
  informationalSchema,
  policySchema,
  referenceLibrary,
  riskAnalysis,
  sourceNames,
  sourceSchema,
  specialistRegistry,
  validateEvidence,
  type Evidence,
  type GenerationContext,
  type Policy,
} from "../lib/chapter11/engine";
import { buildAliases, scanForIdentifiers, sealOutbound, serializeDraftRequest, EgressBlocked } from "../lib/chapter11/egress";
import { internshipInformational, placementInformational, quizInformational } from "../lib/informational";

const ORGANISATION = "Fictional Analytics Works";
const QUIZZES: QuizScore[] = [
  { course: "CS401", title: "Quiz 1", score: 7.5, maximum_score: 10, taken_at: "2026-09-04T05:15:00.000Z", source: "LMS quiz log" },
  { course: "CS402", title: "Quiz 2", score: 3, maximum_score: 10, taken_at: "2026-09-18T05:15:00.000Z", source: "LMS quiz log" },
];
const INTERNSHIP: InternshipRecord = {
  status: "ongoing", registered_on: "2026-08-01", organisation: ORGANISATION, role_title: "Data analytics intern",
  evaluation_grade: "C", evaluation_score: 52, evaluated_on: "2026-09-25", source: "Internship cell register", recorded_on: "2026-09-26",
};
const PLACEMENT: PlacementRecord = {
  readiness_score: 31, readiness_as_of: "2026-10-03", applications: 0, last_applied_on: null, interviews: 0, offers: 0,
  last_outcome: null, outcome_on: null, source: "Placement cell tracker", recorded_on: "2026-10-04",
};
const AT = "2026-10-15T09:00:00.000Z";

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function evidence(student: string): Evidence {
  return Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source, studentId: student, recordId: `SYN-${source}`, observedAt: "2026-10-12T00:00:00.000Z", semester: "2026-ODD",
        state: source === "placement" && rand() < 0.3 ? "not_applicable" : "present", synthetic: true,
        values:
          source === "academic" ? { attendancePct: 30 + rand() * 70, markPct: 20 + rand() * 80 }
            : source === "lms" ? { inactivityDays: Math.floor(rand() * 20), overdueAssignments: Math.floor(rand() * 4) }
              : source === "internship" ? { missedMilestones: Math.floor(rand() * 4), status: "one_missed" }
                : { missedActivities: Math.floor(rand() * 4), status: "several_missed" },
      },
    ]),
  ) as unknown as Evidence;
}
/** The same evidence with the informational blocks the collectors attach. */
function withInformational(e: Evidence): Evidence {
  return {
    ...e,
    lms: { ...e.lms, informational: quizInformational(QUIZZES) },
    internship: { ...e.internship, informational: internshipInformational(INTERNSHIP) },
    placement: { ...e.placement, informational: placementInformational(PLACEMENT) },
  };
}
const graded: Policy = policySchema.parse({ ...demoPolicy, version: "TEST-GRADED", severity: "graded" });

test("the collectors' informational blocks match the contract, carry source and date and say they are not scored", () => {
  for (const block of [quizInformational(QUIZZES), internshipInformational(INTERNSHIP), placementInformational(PLACEMENT), quizInformational([])]) {
    assert.equal(informationalSchema.safeParse(block).success, true, JSON.stringify(block));
    assert.equal(block.scored, false);
    assert.equal(block.note, INFORMATIONAL_NOTE);
    assert.ok(block.origin.length > 3);
  }
  assert.equal(quizInformational(QUIZZES).recordedOn, "2026-09-18");
  assert.deepEqual(quizInformational(QUIZZES).items[0], { course: "CS401", title: "Quiz 1", score: 7.5, maximum: 10, takenAt: "2026-09-04T05:15:00.000Z" });
  assert.equal(internshipInformational(INTERNSHIP).fields.organisation, ORGANISATION);
  assert.equal(placementInformational(PLACEMENT).fields.readinessScore, 31);
  // Evidence captured before this change has no informational block and stays valid.
  const old = evidence(randomUUID());
  for (const name of sourceNames) assert.equal(sourceSchema.safeParse(old[name]).success, true);
});

test("the risk analysis is the same with and without the informational fields (fixed and graded policies)", () => {
  for (let i = 0; i < 300; i++) {
    const student = randomUUID();
    const plain = evidence(student);
    const rich = withInformational(plain);
    for (const policy of [demoPolicy, graded]) {
      const a = riskAnalysis(plain, policy), b = riskAnalysis(rich, policy);
      assert.deepEqual(b, a);
      assert.equal(digest(b), digest(a), "a stored analysis replays to the same digest");
      for (const signal of b.signals) assert.match(signal.path, /^evidence\.(academic|lms|internship|placement)\.values\./);
    }
  }
  // Low quiz scores, a weak evaluation and low readiness raise nothing on their own.
  const calm = withInformational(evidence(randomUUID()));
  for (const name of sourceNames) calm[name] = { ...calm[name], state: "present" };
  Object.assign(calm.academic.values, { attendancePct: 95, markPct: 90 });
  Object.assign(calm.lms.values, { inactivityDays: 0, overdueAssignments: 0 });
  Object.assign(calm.internship.values, { missedMilestones: 0 });
  Object.assign(calm.placement.values, { missedActivities: 0 });
  const risk = riskAnalysis(calm, graded);
  assert.equal(risk.signals.length, 0);
  assert.equal(risk.flagged, false);
});

test("the evidence validator accepts the informational fields; no policy has a threshold for them", () => {
  const student = randomUUID();
  const rich = withInformational(evidence(student));
  for (const name of sourceNames) rich[name] = { ...rich[name], state: "present" };
  assert.doesNotThrow(() => validateEvidence(rich, student, demoPolicy, AT, "2026-ODD"));
  // A malformed block is a contract violation like any other malformed field.
  const forged = { ...rich, lms: { ...rich.lms, informational: { ...rich.lms.informational!, scored: true } } } as unknown as Evidence;
  assert.throws(() => validateEvidence(forged, student, demoPolicy, AT, "2026-ODD"), DataBlocked);
  for (const extra of [{ quizMinimum: 5 }, { readinessMinimum: 50 }, { quizWeight: 10 }])
    assert.equal(policySchema.safeParse({ ...demoPolicy, ...extra }).success, false, `no threshold or weight: ${Object.keys(extra)[0]}`);
});

test("the remote-model payload is identical with and without the informational fields and never names an organisation", () => {
  const catalogue = specialistRegistry.academic.codes.map((code) => ({ code, label: actions[code] }));
  const library = Object.fromEntries(referenceLibrary.map((r) => [r.id, r.text]));
  for (let i = 0; i < 50; i++) {
    const plain = evidence(randomUUID());
    const rich = withInformational(plain);
    const context = (e: Evidence): GenerationContext => {
      const risk = riskAnalysis(e, demoPolicy);
      return { evidence: e, risk, domain: "academic", baseline: formatSkill(risk, "academic"), policy: demoPolicy, references: [], roster: { names: [], phrases: [ORGANISATION] } };
    };
    const salt = `${i}`.padStart(8, "0");
    assert.deepEqual(buildAliases(rich, salt), buildAliases(plain, salt), "the same evidence rows get aliases");
    const options = { aliases: buildAliases(rich, salt), pack: "academic", instruction: specialistRegistry.academic.instruction, catalogue, library, now: Date.parse(AT) };
    const a = serializeDraftRequest(context(plain), options), b = serializeDraftRequest(context(rich), options);
    assert.deepEqual(b, a);
    const sealed = sealOutbound({ messages: [{ role: "user", content: JSON.stringify(b.payload) }] }, { provider: "groq", model: "m", fields: b.fields, roster: context(rich).roster });
    for (const secret of [ORGANISATION, "Data analytics intern", "informational", "readiness", "quiz", "Internship cell register"])
      assert.ok(!sealed.serialized.toLowerCase().includes(secret.toLowerCase()), `payload carries ${secret}`);
    assert.ok(b.payload.evidence.every((row) => typeof row.value === "number"), "numbers only");
  }
  // Second layer: the guard refuses a payload that names a scoped student's organisation.
  assert.equal(scanForIdentifiers(`{"note":"placed at ${ORGANISATION}"}`, { names: [], phrases: [ORGANISATION] }), "roster_name");
  assert.throws(
    () => sealOutbound({ text: `intern at ${ORGANISATION.toUpperCase()}` }, { provider: "groq", model: "m", fields: ["text"], roster: { names: [], phrases: [ORGANISATION] } }),
    EgressBlocked,
  );
});
