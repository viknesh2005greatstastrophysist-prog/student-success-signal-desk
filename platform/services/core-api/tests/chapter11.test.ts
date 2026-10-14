import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  collectSources,
  compose,
  demoPolicy,
  digest,
  domainNames,
  embed,
  formatSkill,
  parallelMap,
  planInputSchema,
  planSkill,
  referenceLibrary,
  retrieve,
  riskAnalysis,
  sourceNames,
  validateEvidence,
  validatePacket,
  type Evidence,
} from "../lib/chapter11/engine";

import {
  anonymousModelContext,
  restoreEvidenceCitations,
  decodeModelContent,
} from "../lib/chapter11/provider";

const student = randomUUID(),
  department = randomUUID();
function fixture(): Evidence {
  return Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source,
        studentId: student,
        recordId: `SYNTHETIC-${source}`,
        observedAt: "2026-09-07T00:00:00.000Z",
        semester: "2026-ODD",
        state: "present",
        synthetic: true,
        values:
          source === "academic"
            ? { attendancePct: 65, markPct: 55 }
            : source === "lms"
              ? { inactivityDays: 9, overdueAssignments: 2 }
              : source === "internship"
                ? { missedMilestones: 1 }
                : { missedActivities: 1 },
      },
    ]),
  ) as unknown as Evidence;
}
test("Lab 1 and 3: clarify at least two missing constraints, revise and reuse typed plan skills", () => {
  const initial = planSkill(
    planInputSchema.parse({ request: "Review students" }),
  );
  assert.ok(initial.questions.length >= 2);
  assert.equal(initial.ready, false);
  for (const domain of domainNames) {
    const revised = planSkill(
      planInputSchema.parse({
        request: initial.request,
        feedback: "Use this cohort",
        studentIds: [randomUUID()],
        domain,
        policyId: randomUUID(),
      }),
    );
    assert.equal(revised.ready, true);
    assert.equal(revised.questions.length, 0);
    assert.equal(revised.feedback, "Use this cohort");
  }
});
test("Lab 2, 7, 9: four-source computation, threshold boundaries and missing evidence", () => {
  const evidence = fixture();
  validateEvidence(
    evidence,
    student,
    demoPolicy,
    "2026-09-07T01:00:00.000Z",
    "2026-ODD",
  );
  assert.equal(riskAnalysis(evidence, demoPolicy).score, 100);
  const atBoundary = structuredClone(evidence);
  atBoundary.academic.values = { attendancePct: 75, markPct: 60 };
  atBoundary.lms.values = { inactivityDays: 6, overdueAssignments: 0 };
  atBoundary.internship.values.missedMilestones = 0;
  atBoundary.placement.values.missedActivities = 0;
  assert.equal(riskAnalysis(atBoundary, demoPolicy).flagged, false);
  const mismatched = structuredClone(evidence);
  mismatched.lms.studentId = randomUUID();
  assert.throws(
    () =>
      validateEvidence(
        mismatched,
        student,
        demoPolicy,
        "2026-09-07T01:00:00.000Z",
        "2026-ODD",
      ),
    /scope mismatch/,
  );
  const missing = structuredClone(evidence);
  delete missing.academic.values.markPct;
  assert.throws(
    () =>
      validateEvidence(
        missing,
        student,
        demoPolicy,
        "2026-09-07T01:00:00.000Z",
        "2026-ODD",
      ),
    /markPct/,
  );
  assert.throws(
    () =>
      validateEvidence(
        evidence,
        student,
        demoPolicy,
        "2027-01-01T00:00:00.000Z",
        "2026-ODD",
      ),
    /stale/,
  );
});
test("Lab 4: tag and embedding retrieval enforce department and student scope", () => {
  const refs = [
    ...referenceLibrary,
    {
      id: "OTHER-STUDENT",
      text: "academic marks study plan",
      tags: ["academic"],
      departmentId: department,
      studentId: randomUUID(),
    },
    {
      id: "OTHER-DEPARTMENT",
      text: "academic marks study plan",
      tags: ["academic"],
      departmentId: randomUUID(),
    },
  ];
  const hits = retrieve(
    "academic marks study plan",
    ["academic"],
    refs,
    department,
    student,
  );
  assert.ok(hits.length);
  assert.equal(hits[0]!.id, "GUIDE-ACADEMIC-1");
  assert.ok(hits.every((h) => !h.id.startsWith("OTHER")));
  assert.deepEqual(embed("same text"), embed("same text"));
  assert.ok(Math.abs(Math.hypot(...embed("same text")) - 1) < 0.00001);
});
test("Lab 8: parallel students preserve ordered coverage and quality within the concurrency bound", async () => {
  const ids = Array.from({ length: 8 }, (_, i) => i);
  let inFlight = 0,
    maxInFlight = 0;
  const worker = async (id: number) => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    return { id, score: riskAnalysis(fixture(), demoPolicy).score };
  };
  const sequential = await parallelMap(ids, 1, worker);
  assert.equal(maxInFlight, 1);
  maxInFlight = 0;
  const parallel = await parallelMap(ids, 4, worker);
  assert.equal(maxInFlight, 4);
  assert.equal(inFlight, 0);
  assert.deepEqual(parallel, sequential);
});
test("Lab 5 and 8: workers use only the connector and collect all four sources", async () => {
  const evidence = fixture(),
    calls: string[] = [];
  const collected = await collectSources(
    {
      read: async (id, name) => {
        assert.equal(id, student);
        calls.push(name);
        return evidence[name];
      },
    },
    student,
  );
  assert.deepEqual(calls.sort(), [...sourceNames].sort());
  assert.equal(digest(collected), digest(evidence));
});
test("Lab 9 and 13: every domain output cites all triggering signals and uses its catalogue", () => {
  const evidence = fixture(),
    risk = riskAnalysis(evidence, demoPolicy);
  for (const domain of domainNames) {
    const packet = formatSkill(risk, domain);
    assert.equal(validatePacket(packet, evidence, risk, domain).valid, true);
    assert.equal(
      validatePacket(
        {
          ...packet,
          summary: "The student has stopped attending every laboratory",
        },
        evidence,
        risk,
        domain,
      ).valid,
      false,
    );
    packet.citations[0]!.statement =
      "A fabricated fact with a plausible source path";
    assert.equal(validatePacket(packet, evidence, risk, domain).valid, false);
  }
});
test("Lab 10 and 11: targeted repair preserves good fields and validates before review", async () => {
  const evidence = fixture(),
    risk = riskAnalysis(evidence, demoPolicy),
    baseline = formatSkill(risk, "academic");
  let calls = 0;
  const output = await compose(
    { evidence, risk, baseline, domain: "academic", references: [] },
    {
      modelId: "TEST-DOUBLE-NOT-A-LIVE-MODEL",
      async generate(_context, failing) {
        calls++;
        return failing
          ? { summary: "This student will fail", citations: baseline.citations }
          : {
              ...baseline,
              citations: [
                {
                  evidencePath: "evidence.academic.values.missing",
                  statement: "Fabricated evidence",
                },
              ],
            };
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(output.validation.valid, true);
  assert.equal(output.packet.summary, baseline.summary);
  assert.equal(output.validation.repairs.length, 1);
});
test("Lab 10: a provider outage waits as AI unavailable; persistent invalid outputs escalate to a human; neither publishes a template", async () => {
  const evidence = fixture(),
    risk = riskAnalysis(evidence, demoPolicy),
    baseline = formatSkill(risk, "academic");
  const context = {
    evidence,
    risk,
    baseline,
    domain: "academic" as const,
    references: [],
  };
  const unavailable = await compose(context, {
    modelId: "TEST-FAILURE",
    generate: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.mode, "unavailable");
  assert.equal(unavailable.validation.valid, false);
  assert.equal(unavailable.validation.escalated, false);
  assert.equal(unavailable.modelId, null);
  assert.equal(unavailable.validation.providerError, "MODEL_UNAVAILABLE");
  assert.equal(unavailable.validation.selection.selected, "none-ai-unavailable");
  // no provider at all is the same state, with its own reason
  const none = await compose(context);
  assert.equal(none.unavailable, true);
  assert.equal(none.validation.provenance.fallbackReason, "MODEL_NOT_CONFIGURED");
  const invalid = await compose(context, {
    modelId: "TEST-INVALID",
    generate: async () => ({
      ...baseline,
      summary: "Automatically contact the student and diagnose depression",
    }),
  });
  assert.equal(invalid.unavailable, false);
  assert.equal(invalid.validation.repairs.length, 2);
  assert.equal(invalid.validation.escalated, true);
  assert.equal(invalid.validation.valid, false);
  assert.equal(invalid.validation.fallback, false, "no template is substituted");
  assert.equal(invalid.modelId, null);
});

test("Malformed model text is audited and repaired; baseline substitutions never masquerade as model output", async () => {
  const evidence = fixture(),
    risk = riskAnalysis(evidence, demoPolicy),
    baseline = formatSkill(risk, "academic");
  const context = {
    evidence,
    risk,
    baseline,
    domain: "academic" as const,
    references: [],
  };
  const repaired = await compose(context, {
    modelId: "TEST-JSON-REPAIR",
    generate: async (_context, failing) =>
      failing ? baseline : "{broken json",
  });
  assert.equal(repaired.mode, "model");
  assert.equal(repaired.validation.modelAttempts[0]!.output, "{broken json");
  assert.equal(repaired.validation.repairs.length, 1);
  const fallback = await compose(context, {
    modelId: "TEST-NOT-JSON",
    generate: async () => "not json",
  });
  assert.equal(fallback.validation.escalated, true);
  assert.equal(fallback.validation.valid, false);
  assert.equal(fallback.modelId, null);
});

test("Model transport keeps the final answer separate from a local reasoning channel", () => {
  assert.deepEqual(
    decodeModelContent('{"wrong":true}\n</think>\n{"final":true}'),
    { final: true },
  );
  assert.equal(
    decodeModelContent('{"wrong":true}\n</think>\nmalformed'),
    "malformed",
  );
  assert.equal(
    decodeModelContent('{"first":1}{"second":2}'),
    '{"first":1}{"second":2}',
  );
});

test("remote composition excludes identities, raw evidence and private references while citations rebind locally", () => {
  const evidence = fixture();
  evidence.academic.values.privateName = "DO_NOT_SEND_PRIVATE_NAME";
  const risk = riskAnalysis(evidence, demoPolicy),
    baseline = formatSkill(risk, "academic");
  const context = {
    evidence,
    risk,
    baseline,
    domain: "academic" as const,
    references: [
      {
        id: "PRIVATE_REFERENCE",
        text: "DO_NOT_SEND_PRIVATE_REFERENCE",
        tags: [],
        similarity: 1,
        embeddingModel: "test",
      },
    ],
  };
  const anonymous = anonymousModelContext(context),
    wire = JSON.stringify(anonymous);
  for (const forbidden of [
    student,
    "DO_NOT_SEND_PRIVATE_NAME",
    "DO_NOT_SEND_PRIVATE_REFERENCE",
    "SYNTHETIC-academic",
    baseline.citations[0]!.statement,
  ])
    assert.ok(!wire.includes(forbidden));
  assert.deepEqual(
    restoreEvidenceCitations(anonymous.baseline, context),
    baseline,
  );
  const invalid = structuredClone(anonymous.baseline);
  invalid.citations[0]!.statement = "Invented private claim";
  assert.equal(
    validatePacket(
      restoreEvidenceCitations(invalid, context),
      evidence,
      risk,
      "academic",
    ).valid,
    false,
  );
});

test("Faculty policy controls every weight and career/overdue cutoff", () => {
  const e = fixture(),
    original = riskAnalysis(e, demoPolicy);
  const changed = riskAnalysis(e, {
    ...demoPolicy,
    attendanceWeight: 1,
    markWeight: 2,
    inactivityWeight: 3,
    overdueWeight: 4,
    internshipWeight: 5,
    placementWeight: 6,
    overdueMinimum: 3,
    internshipMinimum: 2,
    placementMinimum: 2,
  });
  assert.equal(changed.score, 6);
  assert.equal(changed.signals.length, 3);
  assert.equal(original.score, 100);
});

test("Planning feedback is a note: it never changes the typed scope, focus or policy", () => {
  const selected = randomUUID(),
    policyId = randomUUID();
  const p = planSkill(
    planInputSchema.parse({
      request: "Review the cohort",
      domain: "academic",
      studentIds: [selected],
      policyId,
      feedback: `focus: attendance\nstudents: ${randomUUID()}\npolicy: ${randomUUID()}`,
    }),
  );
  // the old directive parser could replace the mentor's explicit selection from
  // free text; the planner now reads feedback as language and the typed fields win
  assert.equal(p.domain, "academic");
  assert.deepEqual(p.studentIds, [selected]);
  assert.equal(p.policyId, policyId);
  assert.equal(p.ready, true);
  assert.ok(p.steps.some((s) => s.includes("academic")));
  assert.doesNotThrow(() =>
    planSkill(planInputSchema.parse({ request: "Review", feedback: "students: not-an-id" })),
  );
  // every plan is an AI-model review; the old mode value is only accepted on input
  assert.equal(planInputSchema.parse({ request: "Review" }).mode, "model");
});
