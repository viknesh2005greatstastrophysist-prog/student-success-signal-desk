import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  compose,
  demoPolicy,
  formatSkill,
  formatSkillV2,
  riskAnalysis,
  sourceNames,
  validateAnyPacket,
  type Composer,
  type Evidence,
  type GenerationContext,
  type PacketV2,
  type RepairDiagnosis,
} from "../lib/chapter11/engine";
import {
  DIAGNOSIS_TEXT,
  REPAIR_VOCABULARY,
  diagnose,
  isSafeInstruction,
} from "../lib/chapter11/diagnosis";
import {
  allowlistRepair,
  buildAliases,
  courseValueKey,
  restoreAliases,
  serializeDraftRequest,
} from "../lib/chapter11/egress";
import { actions } from "../lib/chapter11/catalogue";
import { chainComposer, ModelLimiter } from "../lib/chapter11/provider";
import { route, startMockOpenAI } from "./mock-openai-server";

/** Brief 16-lite: deterministic diagnosis in the repair loop. Stubbed
 * providers and the local mock server only; no network and no live model. */

const student = randomUUID();
const NAME = "Meghana Kulkarni";
const REGISTER = "01FE24BCI047";
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
function context(): GenerationContext {
  const e = evidence();
  const risk = riskAnalysis(e, demoPolicy);
  return {
    evidence: e,
    risk,
    domain: "academic",
    references: [],
    baseline: formatSkillV2(risk, "academic", e),
    policy: demoPolicy,
    roster: { names: [NAME], registers: [REGISTER] },
    aliases: buildAliases(e, "00000001"),
  };
}
const invert = (m: Record<string, string>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

/** The grounded baseline in alias space, as a model would write it. */
function goodDraft(c: GenerationContext): PacketV2 {
  const aliases = c.aliases!;
  const ev = invert(aliases.evidence);
  const courses = invert(aliases.courses);
  const text = (t: string) =>
    Object.entries(courses).reduce((s, [code, alias]) => s.split(code).join(alias), t);
  const out = structuredClone(c.baseline as PacketV2);
  for (const r of out.rationale) {
    r.text = text(r.text);
    r.citations = r.citations.map((p) => ev[p]!);
  }
  for (const a of out.actions) {
    a.personalisation = text(a.personalisation);
    a.talkingPoints = a.talkingPoints.map(text);
    a.citations = a.citations.map((p) => ev[p]!);
  }
  return out;
}
/** A model that rewords everything it was not asked to touch. */
function reworded(draft: PacketV2): PacketV2 {
  const out = structuredClone(draft);
  for (const r of out.rationale) r.text += " This is a main driver.";
  for (const a of out.actions) a.personalisation += " Keep it practical.";
  return out;
}
const tag = (f: { field: string; code: string; path?: string }) =>
  `${f.field}:${f.code}${f.path ? `@${f.path}` : ""}`;
const EV = (c: GenerationContext, path: string) => invert(c.aliases!.evidence)[path]!;
const ATT = "evidence.academic.values.attendancePct";
const MARK = "evidence.academic.values.markPct";
const IDLE = "evidence.lms.values.inactivityDays";
const OVERDUE = "evidence.lms.values.overdueAssignments";

/** Stub provider: attempt n returns drafts[n] (the last one repeats). */
function stub(drafts: PacketV2[]) {
  const seen: Array<{ failing?: unknown; repair?: RepairDiagnosis[] }> = [];
  const composer: Composer = {
    modelId: "diagnosis-stub",
    async generate(_context, failing, _prior, _meta, repair) {
      seen.push({ failing, repair });
      return structuredClone(drafts[Math.min(seen.length - 1, drafts.length - 1)]);
    },
  };
  return { composer, seen };
}
/** value-identical: every field of the part is unchanged (key order aside) */
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

test("the diagnosis wording is the Streamlit ISSUES wording, code for code", () => {
  const labels = readFileSync(
    new URL("../../../../streamlit_app/labels.py", import.meta.url),
    "utf8",
  );
  const block = labels.match(/ISSUES = \{([\s\S]*?)\n\}/)![1]!;
  const issues = Object.fromEntries(
    [...block.matchAll(/"([A-Z_0-9]+)":\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  for (const [code, wording] of Object.entries(DIAGNOSIS_TEXT))
    assert.equal(issues[code], wording, code);
});

test("every validator code gets a diagnosis and an instruction that is safe to send", () => {
  const c = context();
  const paths = [
    undefined,
    "rationale[1]",
    "actions[0]",
    "actions[2].talkingPoints[1]",
    "rationale[0].text",
    "citations[0]",
  ];
  for (const code of [...Object.keys(DIAGNOSIS_TEXT), "SOMETHING_NEW"])
    for (const path of paths) {
      const failure = { field: "actions" as const, code, ...(path ? { path } : {}) };
      const [one] = diagnose([failure], { candidate: goodDraft(c), aliases: c.aliases, risk: c.risk, domain: "academic", roster: c.roster });
      assert.ok(one, code);
      assert.equal(one.code, code);
      assert.ok(isSafeInstruction(one.instruction, c.roster), `${code} ${path}: ${one.instruction}`);
      const [wire] = allowlistRepair([one], c.roster);
      assert.equal(wire!.instruction, one.instruction, `${code} ${path}`);
      assert.ok(one.diagnosis.startsWith(DIAGNOSIS_TEXT[code] ?? "Draft did not pass a check"));
    }
  // deterministic: the same failures and context give the same output
  const failures = [{ field: "rationale" as const, code: "UNSUPPORTED_NUMBER", path: "rationale[1]" }];
  const ctx = { candidate: goodDraft(c), aliases: c.aliases, risk: c.risk, domain: "academic" as const };
  assert.deepEqual(diagnose(failures, ctx), diagnose(failures, ctx));
  assert.ok(REPAIR_VOCABULARY.has("rewrite") && !REPAIR_VOCABULARY.has("meghana"));
});

test("the egress allowlist keeps aliases and codes, and strips any other text to code and path", () => {
  const roster = { names: [NAME], registers: [REGISTER] };
  const kept = allowlistRepair(
    [{ code: "UNSUPPORTED_NUMBER", path: "rationale[1]", instruction: "rewrite rationale r2 (rationale[1]) citing only ev-3, ev-5" }],
    roster,
  );
  assert.match(kept[0]!.instruction, /ev-3, ev-5/);
  for (const instruction of [
    `ask ${NAME} about the missed lectures`,
    `check ${REGISTER} first`,
    "email me at someone@example.com",
    "Attendance in 21CS501 fell on 2026-10-07",
    "x".repeat(401),
  ]) {
    const [out] = allowlistRepair([{ code: "OUTPUT_PII", path: "actions[0]", instruction }], roster);
    assert.equal(out!.instruction, "", instruction);
    assert.equal(out!.code, "OUTPUT_PII");
  }
  assert.deepEqual(allowlistRepair([{ code: "bad code", path: "rationale[1]", instruction: "ok" }]), []);
  assert.deepEqual(allowlistRepair([{ code: "OUTPUT_PII", path: "../../etc", instruction: "ok" }]), []);
  // and the draft payload carries only the allowlisted entries
  const c = context();
  const { payload } = serializeDraftRequest(c, {
    aliases: c.aliases!,
    pack: "academic",
    instruction: "x",
    catalogue: [],
    failing: [{ field: "rationale", code: "UNSUPPORTED_NUMBER", path: "rationale[1]" }, { field: "rationale", code: "UNSUPPORTED_NUMBER", path: "rationale[2]" }],
    repair: [
      { code: "UNSUPPORTED_NUMBER", path: "rationale[1]", instruction: "rewrite rationale r2 (rationale[1]) citing only ev-4" },
      { code: "OUTPUT_PII", path: "actions[0]", instruction: `ask ${NAME}` },
    ],
  });
  assert.deepEqual(payload.failing, ["rationale:UNSUPPORTED_NUMBER"]);
  assert.deepEqual(payload.repair!.map((r) => r.instruction), ["rewrite rationale r2 (rationale[1]) citing only ev-4", ""]);
});

/* ----------------------- the six failure injections ----------------------- */

test("1 ungrounded number: diagnosed to the sentence, repaired, passing parts byte-identical", async () => {
  const c = context();
  const good = goodDraft(c);
  const bad = structuredClone(good);
  bad.rationale[1]!.text = "The average mark is 38% against a 60% minimum in the approved policy.";
  const fixed = reworded(good);
  const { composer, seen } = stub([bad, fixed]);
  const result = await compose(c, composer);

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
  assert.equal(result.mode, "model");
  const [repair] = result.validation.repairs;
  assert.deepEqual(repair!.failures.map(tag), ["rationale:UNSUPPORTED_NUMBER@rationale[1]"]);
  const [d] = repair!.diagnoses;
  assert.equal(d!.code, "UNSUPPORTED_NUMBER");
  assert.equal(d!.path, "rationale[1]");
  assert.equal(d!.diagnosis, "A number not found in the evidence (rationale sentence 2)");
  assert.equal(
    d!.instruction,
    `rewrite rationale r2 (rationale[1]) so every number equals a cited value or a policy threshold, citing only ${EV(c, MARK)}`,
  );
  // the Regenerator got exactly these instructions
  assert.deepEqual(seen[1]!.repair, repair!.diagnoses);
  assert.equal(seen[0]!.repair, undefined);
  // only the failing sentence was taken from the patch
  const packet = result.packet as PacketV2;
  const before = restoreAliases(bad, c.aliases!);
  assert.ok(same(packet.rationale[0], before.rationale[0]));
  assert.ok(same(packet.rationale[2], before.rationale[2]));
  assert.ok(same(packet.actions, before.actions));
  assert.ok(same(packet.rationale[1], restoreAliases(fixed.rationale[1], c.aliases!)));
  assert.deepEqual(result.validation.diagnoses, []);
});

test("2 missing trigger citation: diagnosed with the uncited alias, rationale regenerated, actions untouched", async () => {
  const c = context();
  const good = goodDraft(c);
  const bad = structuredClone(good);
  bad.rationale[2]!.text = "There has been no LMS activity for 9 days, where the policy flags 7 or more.";
  bad.rationale[2]!.citations = [EV(c, IDLE)];
  bad.actions[2]!.personalisation = "Agree dates for the overdue learning activities, starting with the earliest.";
  bad.actions[2]!.citations = [EV(c, IDLE)];
  bad.actions[0]!.citations = [EV(c, ATT), EV(c, MARK), EV(c, IDLE)];
  assert.deepEqual(
    validateAnyPacket(bad, c.evidence, c.risk, "academic", { aliases: c.aliases, policy: c.policy, roster: c.roster, version: 2 }).failures.map(tag),
    ["rationale:MISSING_TRIGGER_COVERAGE"],
  );
  const { composer, seen } = stub([bad, reworded(good)]);
  const result = await compose(c, composer);

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
  const [d] = result.validation.repairs[0]!.diagnoses;
  assert.equal(d!.code, "MISSING_TRIGGER_COVERAGE");
  assert.equal(d!.path, "rationale");
  assert.equal(d!.diagnosis, "A triggering signal was not cited");
  assert.equal(
    d!.instruction,
    `make the rationale and actions together cite every triggering signal, still uncited: ${EV(c, OVERDUE)}`,
  );
  assert.deepEqual(seen[1]!.repair, result.validation.repairs[0]!.diagnoses);
  const packet = result.packet as PacketV2;
  assert.ok(same(packet.actions, restoreAliases(bad.actions, c.aliases!)), "actions are byte-identical");
  assert.ok(packet.rationale[2]!.citations.includes(OVERDUE));
});

test("2b a trigger citation dropped from the server-derived list is diagnosed on the citations field", () => {
  const c = context();
  const bad = goodDraft(c);
  bad.citations = bad.citations.filter((x) => x.evidencePath !== OVERDUE);
  const report = validateAnyPacket(bad, c.evidence, c.risk, "academic", { aliases: c.aliases, policy: c.policy, roster: c.roster, version: 2 });
  assert.deepEqual(report.failures.map(tag), ["citations:MISSING_TRIGGER_COVERAGE"]);
  const [d] = diagnose(report.failures, { candidate: bad, aliases: c.aliases, risk: c.risk, domain: "academic" });
  assert.equal(d!.path, "citations");
  assert.equal(d!.instruction, "make the rationale and actions together cite every triggering signal at least once");
});

test("3 diagnostic language: a persistent fault escalates carrying an accurate diagnosis", async () => {
  const c = context();
  const bad = goodDraft(c);
  bad.actions[0]!.personalisation = "Explain that the attendance pattern suggests depression and arrange a diagnosis.";
  const { composer, seen } = stub([bad]);
  const result = await compose(c, composer);

  assert.equal(seen.length, 3, "one draft and two repairs, then the budget is spent");
  assert.equal(result.validation.escalated, true);
  assert.equal(result.validation.valid, false);
  assert.equal(result.validation.selection.selected, "escalated-to-human");
  assert.equal(result.validation.provenance.fallbackReason, "validation failed after the repair budget");
  assert.deepEqual(result.validation.repairs.map((r) => r.diagnoses.map((d) => `${d.code}@${d.path}`)), [
    ["UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS@actions[0]"],
    ["UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS@actions[0]"],
  ]);
  const [latest, ...rest] = result.validation.diagnoses;
  assert.equal(rest.length, 0);
  assert.equal(latest!.diagnosis, "Unsafe or diagnostic wording (action 1)");
  assert.match(latest!.instruction, /^rewrite action a1 \(actions\[0\]\) as a neutral description of the cited values/);
  assert.ok(!/depress|arrange|suggests/i.test(latest!.instruction), "no draft text in the instruction");
  // The Brief 4 escalation stores the whole validation as the job's failure diagnosis
  // (JSON), so the latest diagnoses and every attempt's diagnoses ride along with it.
  const stored = JSON.parse(JSON.stringify(result.validation)) as typeof result.validation;
  assert.deepEqual(stored.diagnoses, result.validation.diagnoses);
  assert.deepEqual(stored.repairs.map((r) => r.diagnoses.length), [1, 1]);
});

test("4 wrong-domain action code: repaired by replacing that action only", async () => {
  const c = context();
  const good = goodDraft(c);
  const bad = structuredClone(good);
  bad.actions[1] = { ...bad.actions[1]!, code: "wellbeing-referral", label: actions["wellbeing-referral"] };
  const fixed = reworded(good);
  const { composer, seen } = stub([bad, fixed]);
  const result = await compose(c, composer);

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
  const [d] = result.validation.repairs[0]!.diagnoses;
  assert.equal(d!.code, "CATALOGUE_OR_DOMAIN_MISMATCH");
  assert.equal(d!.path, "actions[1]");
  assert.equal(d!.diagnosis, "Action outside the approved catalogue (action 2)");
  assert.equal(
    d!.instruction,
    `rewrite action a2 (actions[1]) so it cites only ${EV(c, MARK)} and uses an academic-domain code, one of faculty-check-in, student-study-plan, lms-catch-up, internship-review, placement-review`,
  );
  assert.deepEqual(seen[1]!.repair, [d]);
  const packet = result.packet as PacketV2;
  const before = restoreAliases(bad, c.aliases!);
  assert.equal(packet.actions[1]!.code, "student-study-plan");
  assert.ok(same(packet.actions[0], before.actions[0]));
  assert.ok(same(packet.actions[2], before.actions[2]));
  assert.ok(same(packet.rationale, before.rationale));
});

test("5 over-length rationale: diagnosed to the field with its limits, repaired", async () => {
  const c = context();
  const good = goodDraft(c);
  const bad = structuredClone(good);
  bad.rationale[0]!.text = "x".repeat(400);
  const { composer, seen } = stub([bad, reworded(good)]);
  const result = await compose(c, composer);

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
  const [d] = result.validation.repairs[0]!.diagnoses;
  assert.equal(d!.code, "LENGTH_LIMIT");
  assert.equal(d!.path, "rationale[0].text");
  assert.equal(d!.diagnosis, "Draft text outside the length limits (rationale sentence 1)");
  assert.equal(d!.instruction, "rewrite rationale r1 (rationale[0].text) to between 12 and 320 characters");
  assert.deepEqual(seen[1]!.repair, [d]);
  const packet = result.packet as PacketV2;
  const before = restoreAliases(bad, c.aliases!);
  assert.ok(same(packet.rationale[1], before.rationale[1]));
  assert.ok(same(packet.rationale[2], before.rationale[2]));
  assert.ok(same(packet.actions, before.actions));
  assert.ok(packet.rationale[0]!.text.length <= 320);
});

test("6 PII string in the output: escalates; the diagnosis names the code and path, never the string", async () => {
  const c = context();
  const bad = goodDraft(c);
  bad.actions[0]!.talkingPoints = [`Ask ${NAME} (${REGISTER}) why course-1 is hard to attend.`];
  bad.actions[0]!.citations = [EV(c, ATT)];
  const { composer, seen } = stub([bad]);
  const result = await compose(c, composer);

  assert.equal(result.validation.escalated, true);
  assert.equal(seen.length, 3);
  const [d] = result.validation.diagnoses;
  assert.equal(d!.code, "OUTPUT_PII");
  assert.equal(d!.path, "actions[0]");
  assert.equal(d!.diagnosis, "Personal details in the draft text (action 1)");
  assert.equal(
    d!.instruction,
    "rewrite action a1 (actions[0]) without names, register numbers, emails, dates or phone numbers and refer to courses only by course aliases",
  );
  const everything = JSON.stringify([result.validation.diagnoses, result.validation.repairs.map((r) => r.diagnoses), seen.map((s) => s.repair)]);
  for (const secret of [NAME, "Meghana", "Kulkarni", REGISTER, "21CS501", student]) assert.ok(!everything.includes(secret), secret);
  for (const r of seen.slice(1)) for (const item of r.repair!) assert.ok(isSafeInstruction(item.instruction, c.roster));
});

/* ------------------------- budget, latest diagnosis, v1 ------------------------- */

test("when the budget runs out the stored diagnoses are the latest ones, with the history per attempt", async () => {
  const c = context();
  const good = goodDraft(c);
  const number = structuredClone(good);
  number.rationale[0]!.text = "Attendance is 41% against the 75% minimum in the approved policy.";
  const pii = structuredClone(good);
  pii.rationale[0]!.text = `Attendance is 64% overall against the 75% minimum, see ${REGISTER}.`;
  const language = structuredClone(good);
  language.rationale[0]!.text = "Attendance is 64% overall against the 75% minimum and the student will fail.";
  const { composer } = stub([number, pii, language]);
  const result = await compose(c, composer);

  assert.equal(result.validation.escalated, true);
  assert.deepEqual(
    result.validation.repairs.map((r) => r.diagnoses.map((d) => `${d.code}@${d.path}`)),
    [["UNSUPPORTED_NUMBER@rationale[0]"], ["OUTPUT_PII@rationale[0]"]],
  );
  assert.deepEqual(
    result.validation.diagnoses.map((d) => `${d.code}@${d.path}`),
    ["UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS@rationale[0]"],
  );
  assert.deepEqual(result.validation.failures.map(tag), ["rationale:UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS@rationale[0]"]);
});

test("a whole-field fault is regenerated as a unit and a clean run stores no diagnoses", async () => {
  const c = context();
  const clean = await compose(c, stub([goodDraft(c)]).composer);
  assert.equal(clean.validation.valid, true);
  assert.deepEqual(clean.validation.diagnoses, []);
  assert.deepEqual(clean.validation.repairs, []);
  const good = goodDraft(c);
  const bad = structuredClone(good) as unknown as Record<string, unknown>;
  bad.rationale = "not a list";
  const result = await compose(c, stub([bad as unknown as PacketV2, reworded(good)]).composer);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.repairs[0]!.diagnoses[0]!.path, "rationale");
  assert.equal(result.validation.repairs[0]!.diagnoses[0]!.instruction, "return rationale again in the required format");
  assert.ok(same((result.packet as PacketV2).rationale, restoreAliases(reworded(good).rationale, c.aliases!)));
});

test("a patch that cannot be applied item by item replaces the whole field instead", async () => {
  const c = context();
  const good = goodDraft(c);
  const bad = structuredClone(good);
  bad.rationale[1]!.text = "The average mark is 38% against a 60% minimum in the approved policy.";
  const shorter = structuredClone(good);
  shorter.rationale = shorter.rationale.slice(0, 2);
  shorter.rationale[0]!.text += " This is a main driver.";
  shorter.rationale[1]!.citations = [EV(c, MARK), EV(c, IDLE), EV(c, OVERDUE)];
  shorter.rationale[1]!.text = "The average mark is 55% against a 60% minimum; LMS inactivity is 9 days.";
  const result = await compose(c, stub([bad, shorter]).composer);
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
  const packet = result.packet as PacketV2;
  assert.equal(packet.rationale.length, 2);
  assert.ok(same(packet.rationale, restoreAliases(shorter.rationale, c.aliases!)));
  assert.ok(same(packet.actions, restoreAliases(bad.actions, c.aliases!)));
});

test("a v1 packet is diagnosed at field level with the same wording", async () => {
  const e = evidence();
  const risk = riskAnalysis(e, demoPolicy);
  const baseline = formatSkill(risk, "academic");
  const bad = structuredClone(baseline);
  bad.summary = "Mentor review requested: the student has depression.";
  const result = await compose(
    { evidence: e, risk, baseline, domain: "academic", references: [] },
    { modelId: "v1-stub", generate: async () => bad },
  );
  assert.equal(result.validation.escalated, true);
  const codes = result.validation.diagnoses.map((d) => `${d.code}@${d.path}`);
  assert.ok(codes.includes("UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS@summary"), codes.join());
  assert.equal(
    result.validation.diagnoses.find((d) => d.code === "UNSUPPORTED_AUTHORITY_OR_DIAGNOSIS")!.instruction,
    "use the baseline summary verbatim or exactly one supplied risk explanation",
  );
});

/* ---------------- the instructions reach a remote model, sealed ---------------- */

/** A mock model that writes a grounded draft in alias space. */
function groundedReply(request: unknown, mutate?: (draft: Record<string, unknown>) => void) {
  const body = request as { messages: Array<{ content: string }> };
  const payload = JSON.parse(body.messages[1]!.content) as {
    evidence: Array<{ ref: string; metric: string; value: number; course?: string }>;
    signals: Array<{ code: string; evidence: string; value: number; threshold: number }>;
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

test("the repair instruction travels in the sealed request and the repaired draft keeps the unaffected parts", async () => {
  let calls = 0;
  const groq = route((request) => {
    calls++;
    return groundedReply(request, calls === 1 ? (d) => { (d.rationale as Array<{ text: string }>)[1]!.text = "The average mark is 38% against a 60% minimum."; } : (d) => { (d.actions as Array<{ personalisation: string }>)[0]!.personalisation += " Keep it practical."; });
  });
  const server = await startMockOpenAI({ "/groq": groq });
  try {
    const c = context();
    const result = await compose(c, chainComposer([{ kind: "groq", base: server.url("/groq"), model: "m", key: "T", remote: true, extra: {} }], { limiter: new ModelLimiter(), maxWaitMs: 0 })!);
    assert.equal(result.validation.valid, true, JSON.stringify(result.validation.failures));
    const repairRequest = JSON.parse(JSON.parse(groq.requests[1]!.raw).messages[1].content) as { failing: string[]; repair: Array<{ code: string; path: string; instruction: string }> };
    assert.deepEqual(repairRequest.failing, ["rationale:UNSUPPORTED_NUMBER"]);
    assert.equal(repairRequest.repair.length, 1);
    assert.equal(repairRequest.repair[0]!.code, "UNSUPPORTED_NUMBER");
    assert.equal(repairRequest.repair[0]!.path, "rationale[1]");
    assert.match(repairRequest.repair[0]!.instruction, /^rewrite rationale r2 \(rationale\[1\]\) so every number equals a cited value or a policy threshold, citing only ev-\d+$/);
    const wire = groq.requests[1]!.raw;
    for (const forbidden of ["21CS501", "21CS502", student, "Meghana", REGISTER, "2026-10-07", "evidence.academic"]) assert.ok(!wire.includes(forbidden), forbidden);
    assert.equal(result.validation.provenance.egress.every((e) => e.outcome === "sent"), true);
    assert.deepEqual(result.validation.repairs[0]!.diagnoses.map((d) => d.code), ["UNSUPPORTED_NUMBER"]);
    // the second action was reworded by the repair reply, but only the failing sentence may change
    const packet = result.packet as PacketV2;
    assert.ok(!packet.actions[0]!.personalisation.includes("Keep it practical"), "passing action kept as first drafted");
  } finally {
    await server.close();
  }
});
