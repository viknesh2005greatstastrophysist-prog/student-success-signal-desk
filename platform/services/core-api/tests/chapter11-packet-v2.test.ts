import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  acceptanceChecks,
  anyPacketSchema,
  compose,
  demoPolicy,
  domainNames,
  formatSkill,
  formatSkillV2,
  riskAnalysis,
  sourceNames,
  validateAnyPacket,
  validatePacket,
  type Evidence,
  type GenerationContext,
  type PacketV2,
} from "../lib/chapter11/engine";
import { buildAliases, courseValueKey } from "../lib/chapter11/egress";
import { hashJson, verifyReplay } from "../lib/support-commands";
import { chainComposer, ModelLimiter, type Endpoint } from "../lib/chapter11/provider";
import { route, startMockOpenAI } from "./mock-openai-server";

const student = randomUUID();
const ATT = "evidence.academic.values.attendancePct";
const COURSE_ATT = `evidence.academic.values.${courseValueKey("attendancePct", "21CS501")}`;
function evidence(): Evidence {
  return Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source,
        studentId: student,
        recordId: `SYNTHETIC-${source}`,
        observedAt: "2026-10-07T00:00:00.000Z",
        semester: "2026-ODD",
        state: "present",
        synthetic: true,
        values:
          source === "academic"
            ? {
                attendancePct: 64,
                markPct: 55,
                [courseValueKey("attendancePct", "21CS501")]: 58,
                [courseValueKey("attendancePct", "21CS502")]: 71,
              }
            : source === "lms"
              ? { inactivityDays: 9, overdueAssignments: 2 }
              : source === "internship"
                ? { missedMilestones: 0 }
                : { missedActivities: 0 },
      },
    ]),
  ) as unknown as Evidence;
}
function context(domain: (typeof domainNames)[number] = "academic"): GenerationContext {
  const e = evidence();
  const risk = riskAnalysis(e, demoPolicy);
  return { evidence: e, risk, domain, references: [], baseline: formatSkillV2(risk, domain, e), policy: demoPolicy, roster: { names: ["Meghana Kulkarni"], registers: ["01FE24BCI047"] } };
}
const options = (c: GenerationContext) => ({ policy: c.policy, roster: c.roster, version: 2 as const });

test("packet-v2 template is valid for every specialist, names the driving course and keeps the four checks", () => {
  for (const domain of domainNames) {
    const c = context(domain);
    const report = acceptanceChecks(c.baseline, c.evidence, c.risk, domain, undefined, options(c));
    assert.deepEqual(report.failures, [], domain);
    assert.equal(report.checks.alerts_cite_triggers, true);
    assert.equal(report.checks.advisor_review_required, true);
    assert.equal(report.checks.privacy_scope_enforced, true);
    const v2 = c.baseline as PacketV2;
    assert.equal(v2.schema, "packet-v2");
    assert.ok(v2.rationale.length >= 2 && v2.rationale.length <= 5);
    if (domain === "wellbeing-referral") {
      // The wellbeing pack never sees more than the triggering signals.
      assert.match(v2.rationale[0]!.text, /^Attendance is 64% against the 75% minimum/);
      assert.ok(!v2.rationale[0]!.citations.includes(COURSE_ATT));
    } else {
      assert.match(v2.rationale[0]!.text, /Attendance is 64% overall against the 75% minimum.*lowest in 21CS501 at 58%/);
      assert.ok(v2.rationale[0]!.citations.includes(COURSE_ATT));
    }
  }
});

function draft(c: GenerationContext): PacketV2 {
  return structuredClone(c.baseline as PacketV2);
}
const codesOf = (c: GenerationContext, p: unknown) =>
  validateAnyPacket(p, c.evidence, c.risk, c.domain, options(c)).failures.map((f) => `${f.field}:${f.code}`);

test("claim-level validator rejects ungrounded numbers, uncited sentences, diagnosis, unknown course aliases and leaks", () => {
  const c = context();
  const ungrounded = draft(c);
  ungrounded.rationale[0]!.text = "Attendance is 41% against the 75% minimum in the approved policy.";
  assert.deepEqual(codesOf(c, ungrounded), ["rationale:UNSUPPORTED_NUMBER"]);
  const rounded = draft(c);
  rounded.rationale[1]!.text = "The average mark is 55.4%, below the 60% minimum in the approved policy.";
  assert.deepEqual(codesOf(c, rounded), []);
  const uncited = draft(c);
  uncited.rationale.push({ text: "The student seems to be struggling with the course overall.", citations: [] });
  assert.deepEqual(codesOf(c, uncited), ["rationale:UNCITED_CLAIM"]);
  const diagnosis = draft(c);
  diagnosis.actions[0]!.personalisation = "Explain that the attendance pattern suggests depression and arrange a diagnosis.";
  assert.ok(codesOf(c, diagnosis).includes("actions:UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS"));
  assert.equal(acceptanceChecks(diagnosis, c.evidence, c.risk, c.domain, undefined, options(c)).checks.advisor_review_required, false);
  const alias = draft(c);
  alias.rationale[0]!.text = "Attendance in course-7 is 58% against the 75% minimum.";
  assert.deepEqual(codesOf(c, alias), ["rationale:UNKNOWN_COURSE_ALIAS"]);
  const badPath = draft(c);
  badPath.rationale[0]!.citations = ["evidence.academic.values.privateNote"];
  assert.ok(codesOf(c, badPath).includes("rationale:UNSUPPORTED_CITATION"));
  const uncovered = draft(c);
  uncovered.rationale = uncovered.rationale.filter((r) => !r.citations.some((p) => p.includes("lms")));
  uncovered.actions = uncovered.actions.filter((a) => !a.citations.some((p) => p.includes("lms")));
  assert.ok(codesOf(c, uncovered).includes("rationale:MISSING_TRIGGER_COVERAGE"));
  const leak = draft(c);
  leak.actions[0]!.talkingPoints = ["Ask Meghana how the 58% attendance in 21CS501 happened."];
  leak.actions[0]!.citations = [COURSE_ATT];
  assert.ok(codesOf(c, leak).includes("actions:OUTPUT_PII"));
  assert.equal(acceptanceChecks(leak, c.evidence, c.risk, c.domain, undefined, options(c)).checks.privacy_scope_enforced, false);
  const catalogue = draft(c);
  catalogue.actions[0]!.code = "wellbeing-referral";
  assert.ok(codesOf(c, catalogue).includes("actions:CATALOGUE_OR_DOMAIN_MISMATCH"));
  const long = draft(c);
  long.rationale[0]!.text = "x".repeat(400);
  assert.deepEqual(codesOf(c, long), ["rationale:LENGTH_LIMIT"]);
  const label = draft(c);
  label.actions[0]!.talkingPoints = ["Book a 20-minute slot within 7 days and cover the 58% figure."];
  label.actions[0]!.citations = [COURSE_ATT];
  assert.deepEqual(codesOf(c, label), []);
});

test("v1 packets still parse and validate under the v1 exact-string rules", () => {
  const c = context();
  const v1 = formatSkill(c.risk, "academic");
  assert.ok(anyPacketSchema.safeParse(v1).success);
  assert.ok(anyPacketSchema.safeParse(c.baseline).success);
  assert.equal(validateAnyPacket(v1, c.evidence, c.risk, "academic").valid, true);
  assert.equal(acceptanceChecks(v1, c.evidence, c.risk, "academic").valid, true);
  const fabricated = structuredClone(v1);
  fabricated.citations[0]!.statement = "A fabricated fact with a plausible source path";
  assert.equal(validateAnyPacket(fabricated, c.evidence, c.risk, "academic").valid, false);
  assert.deepEqual(validateAnyPacket(fabricated, c.evidence, c.risk, "academic"), validatePacket(fabricated, c.evidence, c.risk, "academic"));
});

/** A mock model that reads the anonymised payload and writes a grounded draft. */
function groundedReply(request: unknown, mutate?: (draft: Record<string, unknown>) => void) {
  const body = request as { messages: Array<{ content: string }> };
  const payload = JSON.parse(body.messages[1]!.content) as {
    evidence: Array<{ ref: string; metric: string; value: number; course?: string }>;
    signals: Array<{ code: string; evidence: string; value: number; threshold: number }>;
    catalogue: Array<{ code: string }>;
  };
  const lowest = payload.evidence.filter((e) => e.course && e.metric === "attendancePct").sort((a, b) => a.value - b.value)[0]!;
  const sig = (code: string) => payload.signals.find((s) => s.code === code)!;
  const att = sig("ATTENDANCE_LOW"), mark = sig("MARK_LOW"), lms = sig("LMS_INACTIVE"), overdue = sig("ASSIGNMENT_OVERDUE");
  const out: Record<string, unknown> = {
    rationale: [
      { text: `Attendance in ${lowest.course} has fallen to ${Math.round(lowest.value)}% against the ${att.threshold}% minimum, pulling the overall figure to ${att.value}%.`, citations: [lowest.ref, att.evidence] },
      { text: `The average mark is ${mark.value}% against a ${mark.threshold}% minimum.`, citations: [mark.evidence] },
      { text: `There has been no LMS activity for ${lms.value} days and ${overdue.value} activities are overdue.`, citations: [lms.evidence, overdue.evidence] },
    ],
    actions: [
      { code: "faculty-check-in", personalisation: `Start with ${lowest.course}, where attendance is lowest, before the other indicators.`, talkingPoints: [`What has made ${lowest.course} harder to attend?`], dueInDays: 5, citations: [lowest.ref] },
      { code: "lms-catch-up", personalisation: `Agree dates for the ${overdue.value} overdue activities.`, talkingPoints: ["Which activity can be finished first?"], dueInDays: 7, citations: [overdue.evidence, lms.evidence] },
    ],
  };
  mutate?.(out);
  return { content: JSON.stringify(out) };
}

test("model draft in alias space is validated, then restored to the real course for the mentor", async () => {
  const seen: unknown[] = [];
  const groq = route((request) => { seen.push(request); return groundedReply(request); });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    const endpoints: Endpoint[] = [{ kind: "groq", base: server.url("/groq"), model: "qwen/qwen3.8-27b", key: "TEST", remote: true, extra: { reasoning_effort: "none" } }];
    const c = context();
    const result = await compose(c, chainComposer(endpoints, { limiter: new ModelLimiter(), maxWaitMs: 0 })!);
    assert.equal(result.mode, "model", JSON.stringify(result.validation.failures));
    assert.equal(result.validation.valid, true);
    assert.equal(result.modelId, "groq:qwen/qwen3.8-27b");
    const packet = result.packet as PacketV2;
    assert.match(packet.rationale[0]!.text, /^Attendance in 21CS501 has fallen to 58% against the 75% minimum/);
    assert.deepEqual(packet.rationale[0]!.citations, [COURSE_ATT, ATT]);
    assert.equal(packet.actions[0]!.label, "Schedule a 20-minute academic check-in with the assigned mentor");
    const wire = groq.requests[0]!.raw;
    for (const forbidden of ["21CS501", "21CS502", student, "Meghana", "2026-10-07", "evidence.academic"]) assert.ok(!wire.includes(forbidden), forbidden);
    const schema = (seen[0] as { response_format: { json_schema: { strict: boolean } } }).response_format.json_schema;
    assert.equal(schema.strict, true);
    assert.equal((seen[0] as { tools?: unknown }).tools, undefined);
    assert.equal(result.validation.provenance.egress[0]!.outcome, "sent");
  } finally {
    await server.close();
  }
});

test("a model number that is not in the evidence is repaired once, then a persistent fault falls back to the labelled v2 template", async () => {
  let calls = 0;
  const groq = route((request) => {
    calls++;
    return groundedReply(request, calls === 1 ? (d) => { (d.rationale as Array<{ text: string }>)[1]!.text = "The average mark is 38% against a 60% minimum."; } : undefined);
  });
  const bad = route((request) => groundedReply(request, (d) => { (d.actions as Array<{ personalisation: string }>)[0]!.personalisation = "Tell the student they will fail unless attendance improves."; }));
  const server = await startMockOpenAI({ "/groq": groq, "/bad": bad });
  try {
    const c = context();
    const repaired = await compose(c, chainComposer([{ kind: "groq", base: server.url("/groq"), model: "m", key: "T", remote: true, extra: {} }], { limiter: new ModelLimiter(), maxWaitMs: 0 })!);
    assert.equal(repaired.validation.valid, true);
    assert.deepEqual(repaired.validation.repairs[0]!.failures.map((f) => `${f.field}:${f.code}`), ["rationale:UNSUPPORTED_NUMBER"]);
    assert.equal(repaired.mode, "model");
    const failing = JSON.parse(JSON.parse(groq.requests[1]!.raw).messages[1].content).failing;
    assert.deepEqual(failing, ["rationale:UNSUPPORTED_NUMBER"]);
    const fallback = await compose(context(), chainComposer([{ kind: "groq", base: server.url("/bad"), model: "m", key: "T", remote: true, extra: {} }], { limiter: new ModelLimiter(), maxWaitMs: 0 })!);
    // a persistent fault stops at the human gate; no template is substituted or published
    assert.equal(fallback.mode, "model");
    assert.equal(fallback.unavailable, false);
    assert.equal(fallback.validation.escalated, true);
    assert.equal(fallback.validation.valid, false);
    assert.equal(fallback.validation.fallback, false);
    assert.equal(fallback.modelId, null);
    assert.equal(fallback.validation.provenance.fallbackReason, "validation failed after the repair budget");
  } finally {
    await server.close();
  }
});

test("aliases are fresh per run and the course order is salted", () => {
  const e = evidence();
  const a = buildAliases(e, "00000001"), b = buildAliases(e, "ffffffff");
  assert.notEqual(a.caseAlias, b.caseAlias);
  assert.deepEqual(new Set(Object.values(a.courses)), new Set(["21CS501", "21CS502"]));
});

// Replay: a stored packet is revalidated under its own version and must still
// fail when either the snapshot or the packet was altered after execution.
function stored(c: GenerationContext, packet: unknown) {
  const evidence = { ...structuredClone(c.evidence), chapterJobId: randomUUID(), risk: c.risk, policy: c.policy, domain: c.domain } as unknown as Record<string, unknown>;
  return { evidence, recommendation: packet, input_hash: hashJson(evidence), content_hash: hashJson(packet) };
}

test("replay matches a recorded packet-v2 and a recorded v1 packet", () => {
  const c = context();
  const v2 = stored(c, c.baseline);
  assert.equal((c.baseline as PacketV2).schema, "packet-v2");
  assert.equal(verifyReplay(v2).matched, true);
  const v1 = stored(c, formatSkill(c.risk, c.domain));
  assert.equal(verifyReplay(v1).matched, true);
});

test("replay reports a mismatch when the v2 packet or its snapshot was tampered with", () => {
  const c = context();
  // Packet altered after execution: the recorded output hash no longer matches.
  const swapped = stored(c, c.baseline);
  const edited = structuredClone(c.baseline as PacketV2);
  edited.rationale[0]!.text = "Attendance is 41% against the 75% minimum in the approved policy.";
  assert.equal(verifyReplay({ ...swapped, recommendation: edited }).matched, false);
  // Packet altered and its hash re-recorded: claim-level validation still rejects it.
  assert.equal(verifyReplay(stored(c, edited)).matched, false);
  // Snapshot altered after execution: the recorded input hash no longer matches.
  const original = stored(c, c.baseline);
  const evidence = structuredClone(original.evidence) as { academic: { values: Record<string, number> } };
  evidence.academic.values.attendancePct = 80;
  assert.equal(verifyReplay({ ...original, evidence: evidence as unknown as Record<string, unknown> }).matched, false);
  // Snapshot and its hash both re-recorded, but the stored risk no longer derives from it.
  assert.equal(verifyReplay({ ...original, evidence: evidence as unknown as Record<string, unknown>, input_hash: hashJson(evidence) }).matched, false);
});
