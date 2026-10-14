import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  acceptanceChecks,
  compose,
  demoPolicy,
  formatSkillV2,
  riskAnalysis,
  routeSpecialist,
  sourceNames,
  specialistRegistry,
  validateAnyPacket,
  type Evidence,
  type GenerationContext,
  type PacketV2,
} from "../lib/chapter11/engine";
import { courseValueKey } from "../lib/chapter11/egress";
import { createNodeRunner, reviewGraph, specialistNodes, type NodeTrace } from "../lib/chapter11/graph";
import { chainComposer, ModelLimiter } from "../lib/chapter11/provider";
import { projectProfileComposer } from "../lib/chapter11/project-composer";
import { route, startMockOpenAI } from "./mock-openai-server";

const student = randomUUID();
function evidence(values: { attendancePct: number; markPct: number; inactivityDays: number; overdueAssignments: number }): Evidence {
  return Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source, studentId: student, recordId: `SYNTHETIC-${source}`, observedAt: "2026-10-07T00:00:00.000Z", semester: "2026-ODD", state: "present", synthetic: true,
        values:
          source === "academic"
            ? { attendancePct: values.attendancePct, markPct: values.markPct, [courseValueKey("attendancePct", "21CS501")]: values.attendancePct - 6, [courseValueKey("attendancePct", "21CS502")]: values.attendancePct + 6 }
            : source === "lms"
              ? { inactivityDays: values.inactivityDays, overdueAssignments: values.overdueAssignments }
              : source === "internship" ? { missedMilestones: 0 } : { missedActivities: 0 },
      },
    ]),
  ) as unknown as Evidence;
}
const ATTENDANCE_CASE = { attendancePct: 62, markPct: 72, inactivityDays: 2, overdueAssignments: 0 };
const ACADEMIC_CASE = { attendancePct: 90, markPct: 48, inactivityDays: 10, overdueAssignments: 3 };
function context(values: typeof ATTENDANCE_CASE, planDomain: "academic" | "attendance" | "wellbeing-referral"): GenerationContext {
  const e = evidence(values), risk = riskAnalysis(e, demoPolicy);
  return { evidence: e, risk, domain: planDomain, references: [{ id: randomUUID(), text: "Earlier approved support actions: attendance-review", tags: ["attendance"], similarity: 0.4, embeddingModel: "x", actionCodes: ["attendance-review"] }], baseline: formatSkillV2(risk, planDomain, e), policy: demoPolicy };
}

test("coordinator routes by signals; wellbeing runs only when the mentor asks for it", () => {
  const sig = (code: string, points: number) => ({ code, points });
  assert.equal(routeSpecialist([sig("ATTENDANCE_LOW", 20)], "academic"), "attendance");
  assert.equal(routeSpecialist([sig("MARK_LOW", 20), sig("LMS_INACTIVE", 20)], "attendance"), "academic");
  assert.equal(routeSpecialist([sig("ATTENDANCE_LOW", 20), sig("MARK_LOW", 20)], "attendance"), "attendance");
  assert.equal(routeSpecialist([sig("ATTENDANCE_LOW", 20), sig("MARK_LOW", 20)], "academic"), "academic");
  assert.equal(routeSpecialist([sig("MARK_LOW", 20)], "wellbeing-referral"), "wellbeing-referral");
  for (const node of specialistNodes) assert.ok(reviewGraph.nodes.includes(node));
});

test("each specialist pack's fixture is domain-correct and passes its own checks", () => {
  const attendance = context(ATTENDANCE_CASE, "academic").baseline as PacketV2;
  assert.equal(attendance.specialist, "attendance");
  assert.deepEqual(attendance.actions.map((a) => a.code), ["faculty-check-in", "attendance-review"]);
  assert.match(attendance.actions[1]!.personalisation, /attendance is 62% against the 75% minimum/);
  const academic = context(ACADEMIC_CASE, "attendance").baseline as PacketV2;
  assert.equal(academic.specialist, "academic");
  assert.deepEqual(academic.actions.map((a) => a.code), ["faculty-check-in", "student-study-plan", "lms-catch-up"]);
  const wellbeing = context(ATTENDANCE_CASE, "wellbeing-referral").baseline as PacketV2;
  assert.equal(wellbeing.specialist, "wellbeing-referral");
  assert.deepEqual(wellbeing.actions.map((a) => a.code), ["faculty-check-in", "wellbeing-referral"]);
  assert.ok(!JSON.stringify(wellbeing.rationale).includes("21CS501"), "wellbeing never sees more than the triggering signals");
  for (const [c, packet] of [[context(ATTENDANCE_CASE, "academic"), attendance], [context(ACADEMIC_CASE, "attendance"), academic], [context(ATTENDANCE_CASE, "wellbeing-referral"), wellbeing]] as const) {
    const report = acceptanceChecks(packet, c.evidence, c.risk, c.domain, undefined, { policy: c.policy });
    assert.deepEqual(report.failures, [], packet.specialist);
  }
});

test("wellbeing pack rejects diagnostic or labelling language, non-referral actions and non-triggering evidence", () => {
  const c = context(ATTENDANCE_CASE, "wellbeing-referral");
  const codes = (p: unknown) => validateAnyPacket(p, c.evidence, c.risk, c.domain, { policy: c.policy }).failures.map((f) => `${f.field}:${f.code}`);
  const base = () => structuredClone(c.baseline as PacketV2);
  const diagnosis = base();
  diagnosis.rationale[0]!.text = "Attendance is 62% against the 75% minimum, which may indicate depression.";
  assert.ok(codes(diagnosis).includes("rationale:UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS"));
  const label = base();
  label.actions[1]!.personalisation = "The student seems to be anxious and is probably struggling at home.";
  assert.ok(codes(label).includes("actions:SPECIALIST_LANGUAGE"));
  const nonReferral = base();
  nonReferral.actions[1] = { ...nonReferral.actions[1]!, code: "attendance-review", label: "Review attendance barriers and agree an attendance plan with the mentor" };
  assert.ok(codes(nonReferral).includes("actions:CATALOGUE_OR_DOMAIN_MISMATCH"));
  const scope = base();
  scope.rationale[0] = { text: "Attendance in 21CS501 is 56% against the 75% minimum.", citations: [`evidence.academic.values.${courseValueKey("attendancePct", "21CS501")}`] };
  assert.ok(codes(scope).includes("rationale:SPECIALIST_SCOPE"));
  // The same labelling sentence is acceptable for the attendance pack.
  const attendance = context(ATTENDANCE_CASE, "attendance");
  const ok = structuredClone(attendance.baseline as PacketV2);
  ok.actions[1]!.personalisation = "Attendance is 62% against the 75% minimum; ask which classes are hardest to reach.";
  assert.deepEqual(validateAnyPacket(ok, attendance.evidence, attendance.risk, attendance.domain, { policy: demoPolicy }).failures, []);
});

test("each pack sends its own prompt, catalogue subset and evidence view; the trace records the specialist node", async () => {
  const seen: Array<{ system: string; payload: { catalogue: Array<{ code: string }>; evidence: Array<{ ref: string; course?: string }>; priorInterventions: unknown[]; signals: Array<{ evidence: string }> }; schema: unknown }> = [];
  const model = route((request) => {
    const body = request as { messages: Array<{ content: string }>; response_format: { json_schema: { schema: unknown } } };
    const payload = JSON.parse(body.messages[1]!.content);
    seen.push({ system: body.messages[0]!.content, payload, schema: body.response_format.json_schema.schema });
    const s = payload.signals[0];
    return { content: JSON.stringify({
      rationale: [
        { text: `Attendance is ${s.value}% against the ${s.threshold}% minimum.`, citations: [s.evidence] },
        { text: "The mentor should confirm this reading with the student first.", citations: [s.evidence] },
      ],
      actions: [{ code: "faculty-check-in", personalisation: "Go through the attendance figure together and agree one next step.", talkingPoints: ["What would help most this week?"], dueInDays: 5, citations: [s.evidence] }],
    }) };
  });
  const server = await startMockOpenAI({ "/m": model });
  try {
    const composer = chainComposer([{ kind: "groq", base: server.url("/m"), model: "m", key: "T", remote: true, extra: {} }], { limiter: new ModelLimiter(), maxWaitMs: 0 })!;
    for (const domain of ["attendance", "wellbeing-referral"] as const) {
      const trace: NodeTrace = {};
      const result = await compose(context(ATTENDANCE_CASE, domain), composer, createNodeRunner(trace));
      assert.equal(result.mode, "model", JSON.stringify(result.validation.failures));
      const pack = specialistRegistry[domain];
      assert.equal(trace[pack.node]?.visits, 1);
      assert.equal(result.validation.provenance.specialist, domain);
      const last = seen.at(-1)!;
      assert.ok(last.system.includes(pack.systemPrompt));
      assert.deepEqual(last.payload.catalogue.map((c) => c.code), pack.codes);
      if (domain === "wellbeing-referral") {
        assert.deepEqual(last.payload.evidence.map((e) => e.ref), last.payload.signals.map((s) => s.evidence));
        assert.ok(last.payload.evidence.every((e) => !e.course));
        assert.deepEqual(last.payload.priorInterventions, []);
        assert.ok(!JSON.stringify(last.schema).includes("ev-4"));
      } else {
        assert.ok(last.payload.evidence.some((e) => e.course));
        assert.equal(last.payload.priorInterventions.length, 1);
      }
    }
  } finally {
    await server.close();
  }
});

test("cross-student profile reuse is retired for mentor review and only runs as a labelled bulk dry run", async () => {
  const stub = { modelId: "STUB", async generate(c: GenerationContext) { return c.baseline; } };
  assert.throws(() => projectProfileComposer(stub, undefined as never), /retired/);
  const dry = projectProfileComposer(stub, { bulkDryRun: true });
  assert.match(dry.composer.modelId, /bulk dry run, not for mentor review/);
  // a mentor-review (packet-v2) context is refused, so nothing is drafted: AI unavailable
  const result = await compose(context(ACADEMIC_CASE, "academic"), dry.composer);
  assert.equal(result.unavailable, true);
  assert.equal(result.mode, "unavailable");
  assert.equal(result.validation.valid, false);
  assert.equal(dry.stats.actualModelCalls, 0);
});
