import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { demoPolicy } from "../lib/chapter11/engine";
import {
  buildPlannerAliases,
  groundCriteria,
  isAnswered,
  matches,
  resolvePlannerOutput,
  runPlanner,
  scopeConflictQuestion,
  type PlanningScope,
} from "../lib/chapter11/planner";
import { mergeNotes } from "../lib/chapter11/planning";
import { ModelLimiter } from "../lib/chapter11/provider";
import { groqEndpoint } from "./agent-fixtures";
import { plannerJson, route, scriptedPlanner, startMockOpenAI } from "./mock-openai-server";

/** E2E log L1, L2, L3, L7 and #13: the mentor's explicit "Students in scope"
 * selection is authoritative; the planner narrows within it or asks, a request
 * that describes a different set is a conflict the mentor confirms; resolution
 * is deterministic; answered questions stay answered. Stubs only: no network
 * beyond the local mock server, no database, no live model. */

const MENTOR = randomUUID();
const POLICY = randomUUID();
const semesters = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
function scope(): PlanningScope {
  return {
    students: semesters.map((semester, i) => ({
      id: randomUUID(),
      semester,
      // the first eight are below the 75% minimum
      attendancePct: i < 8 ? 50 + i * 3 : 85 + (i % 3),
      markPct: 80 - i * 2,
      mentorId: MENTOR,
    })),
    policies: [{ id: POLICY, facultyId: MENTOR, policy: demoPolicy }],
  };
}
const REQUEST =
  "Check my mentees whose attendance is below the policy threshold this cycle and prepare support plans for the ones at highest risk.";
const ctxFor = (s: PlanningScope, extra: Record<string, unknown> = {}) => ({
  scope: s,
  aliases: buildPlannerAliases(s, "fixed-salt"),
  pins: {},
  ...extra,
});

test("an explicit selection wins over the request text, and the conflict is surfaced", () => {
  const s = scope();
  const chosen = s.students[11]!; // not below 75%, semester 8
  const belowThreshold = s.students.filter((x) => matches(x, { attendanceBelowPct: 75 }));
  // The model reads "my mentees ..." as allMine and also invents a semester window
  // and a mark cut-off, exactly as in the logged run (27 students after answering).
  const out = plannerJson({
    domain: "attendance",
    policy: "policy-1",
    allMine: true,
    filter: { attendanceBelowPct: 75, semesterMin: 4, semesterMax: 8, markBelowPct: 60 },
  });
  const r = resolvePlannerOutput(out, ctxFor(s, { pins: { studentIds: [chosen.id] }, text: REQUEST }))!;
  assert.deepEqual(r.studentIds, [chosen.id], "the selection is never replaced or widened");
  assert.equal(r.scope!.basis, "selected");
  assert.equal(r.scope!.selected, 1);
  assert.deepEqual(r.conflict, {
    selected: 1,
    implied: belowThreshold.length,
    impliedStudentIds: belowThreshold.map((x) => x.id),
  });
  assert.equal(r.questions[0], scopeConflictQuestion(r.conflict!));
  assert.match(r.questions[0]!, /Nothing changes until you confirm/);
  assert.ok(r.ignored.includes("criteria"), "the invented semester window and mark cut-off were dropped");
  assert.deepEqual(r.filter, { allMine: true, attendanceBelowPct: 75 });
});

test("a request set above 50 students is a conflict with no switch option", () => {
  const many: PlanningScope = {
    students: Array.from({ length: 60 }, () => ({ id: randomUUID(), semester: 5, attendancePct: 60, markPct: 70, mentorId: MENTOR })),
    policies: [{ id: POLICY, facultyId: MENTOR, policy: demoPolicy }],
  };
  const r = resolvePlannerOutput(plannerJson({ allMine: true }), ctxFor(many, { pins: { studentIds: [many.students[0]!.id] }, text: "review all my mentees" }))!;
  assert.equal(r.conflict!.implied, 60);
  assert.equal(r.conflict!.impliedStudentIds, undefined);
  assert.match(r.questions[0]!, /more than a review covers \(50\)/);
  assert.equal(r.studentIds!.length, 1);
});

test("the planner may narrow within a selection but never add a student to it", () => {
  const s = scope();
  const selection = s.students.slice(0, 8).map((x) => x.id); // semesters 3..6
  const r = resolvePlannerOutput(
    plannerJson({ filter: { semesterMax: 4 } }),
    ctxFor(s, { pins: { studentIds: selection }, text: "only up to semester 4" }),
  )!;
  assert.equal(r.conflict, undefined);
  assert.deepEqual(r.studentIds, s.students.filter((x) => selection.includes(x.id) && x.semester <= 4).map((x) => x.id));
  assert.ok(r.studentIds!.every((id) => selection.includes(id)));
  assert.deepEqual(r.scope, { basis: "selected", selected: 4, narrowedFrom: 8 });
});

test("criteria that match nothing in the selection leave it untouched and ask", () => {
  const s = scope();
  const selection = [s.students[11]!.id, s.students[10]!.id];
  const r = resolvePlannerOutput(
    plannerJson({ filter: { attendanceBelowPct: 75 } }),
    ctxFor(s, { pins: { studentIds: selection }, text: "attendance below 75" }),
  )!;
  assert.deepEqual(r.studentIds, selection);
  assert.match(r.questions[0]!, /None of the 2 students you selected/);
});

test("a conflict the mentor already kept is not raised again", () => {
  const s = scope();
  const selection = [s.students[11]!.id];
  const r = resolvePlannerOutput(
    plannerJson({ allMine: true, filter: { attendanceBelowPct: 75 } }),
    ctxFor(s, { pins: { studentIds: selection }, text: REQUEST, conflictKept: true }),
  )!;
  assert.equal(r.conflict, undefined);
  assert.deepEqual(r.studentIds, selection);
  assert.deepEqual(r.questions, []);
});

test("without a selection the same request resolves to the same students, whatever extra criteria the model invents", () => {
  const s = scope();
  const base = { domain: "attendance", policy: "policy-1", allMine: true } as const;
  const steady = resolvePlannerOutput(plannerJson({ ...base, filter: { attendanceBelowPct: 75 } }), ctxFor(s, { text: REQUEST }))!;
  // L7: later saves of the same request drifted (27, then 53). The drift was
  // criteria the request never stated, such as a semester window or a mark cut-off.
  const drift1 = resolvePlannerOutput(
    plannerJson({ ...base, filter: { attendanceBelowPct: 75, markBelowPct: 60, semesterMin: 4, semesterMax: 8 } }),
    ctxFor(s, { text: REQUEST }),
  )!;
  const drift2 = resolvePlannerOutput(
    plannerJson({ ...base, filter: { attendanceBelowPct: 75, semesterMin: 4 } }),
    ctxFor(s, { text: REQUEST }),
  )!;
  const again = resolvePlannerOutput(plannerJson({ ...base, filter: { attendanceBelowPct: 75 } }), ctxFor(s, { text: REQUEST }))!;
  for (const other of [drift1, drift2, again]) {
    assert.deepEqual(other.studentIds, steady.studentIds);
    assert.deepEqual(other.filter, steady.filter);
  }
  assert.equal(steady.studentIds!.length, s.students.filter((x) => matches(x, { attendanceBelowPct: 75 })).length);
  assert.ok(drift1.ignored.includes("criteria"));
});

test("criteria are grounded in the mentor's words or an approved threshold", () => {
  const policies = scope().policies;
  const ground = (c: Parameters<typeof groundCriteria>[0], text: string) => groundCriteria(c, text, policies);
  // stated numbers and policy thresholds are kept; a number nobody stated is not
  assert.deepEqual(ground({ attendanceBelowPct: 80 }, "attendance below 80%").criteria, { attendanceBelowPct: 80 });
  assert.deepEqual(ground({ attendanceBelowPct: demoPolicy.attendanceMinimum }, "attendance below the policy threshold").criteria, {
    attendanceBelowPct: demoPolicy.attendanceMinimum,
  });
  assert.deepEqual(ground({ attendanceBelowPct: 62 }, "attendance below the policy threshold").dropped, ["attendanceBelowPct"]);
  // a topic the text never mentions is not added
  assert.deepEqual(ground({ markBelowPct: 60 }, "attendance below 75").dropped, ["markBelowPct"]);
  assert.deepEqual(ground({ semesterMin: 4 }, "attendance below 75").dropped, ["semesterMin"]);
  assert.deepEqual(ground({ semesterMax: 6 }, "leave out final-years").criteria, { semesterMax: 6 });
});

test("answered questions are resolved: paraphrases are dropped, new ones kept, and nobody is asked which student was selected", () => {
  const s = scope();
  const answered = ["Which time window does 'this cycle' refer to, and should I use the current cycle's attendance figures?"];
  assert.equal(
    isAnswered("Which time window does 'this cycle' refer to, and should I use the current cycle's attendance figures as you specified?", answered),
    true,
  );
  assert.equal(isAnswered("What should 'highest risk' be measured by?", answered), false);
  const r = resolvePlannerOutput(
    plannerJson({
      questions: [
        "Which time window does 'this cycle' refer to, and should I use the current cycle's attendance figures as you specified?",
        "Which single student did you select in Students in scope, so I can limit the plan to just that one?",
        "Should students on approved leave be left out of this review?",
      ],
    }),
    ctxFor(s, { pins: { studentIds: [s.students[0]!.id] }, text: "review", answered }),
  )!;
  assert.deepEqual(r.questions, ["Should students on approved leave be left out of this review?"]);
  assert.ok(r.ignored.includes("answered"));
  // without a selection, the "which students" question is a real one and is kept
  const open = resolvePlannerOutput(
    plannerJson({ questions: ["Which students should this review start with, first years or final years?"] }),
    ctxFor(s, { text: "review" }),
  )!;
  assert.equal(open.questions.length, 1);
});

test("the planner is told the selection and the resolved questions, by alias and text only", async () => {
  const s = scope();
  const aliases = buildPlannerAliases(s, "fixed-salt");
  const chosen = s.students[3]!;
  const mock = route(scriptedPlanner(() => ({ domain: "attendance", allMine: false })));
  const server = await startMockOpenAI({ "/m": mock });
  try {
    const outcome = await runPlanner({
      request: "Check attendance for the students I selected",
      feedback: "Use the current cycle.",
      scope: s,
      pins: { studentIds: [chosen.id] },
      endpoints: [groqEndpoint(server.url("/m"))],
      options: { limiter: new ModelLimiter(), maxWaitMs: 0 },
      aliases,
      answered: ["Which time window does 'this cycle' refer to?"],
    });
    assert.deepEqual(outcome.resolution!.studentIds, [chosen.id]);
    const sent = mock.requests.map((r) => r.raw).join("\n");
    const alias = Object.entries(aliases.students).find(([, id]) => id === chosen.id)![0];
    assert.ok(sent.includes(alias), "the selection travels as an alias");
    assert.ok(sent.includes("studentAliases") && sent.includes("resolved"));
    assert.ok(sent.includes("Which time window does"));
    for (const student of s.students) assert.ok(!sent.includes(student.id), "no student id leaves the server");
  } finally {
    await server.close();
  }
});

test("feedback notes accumulate one per line and old text is never spliced into new text", () => {
  // #13: the revision box kept the saved text, so a new answer was typed into
  // the middle of it ("...score frLimit this plan...om the approved policy").
  const first = "Use the current cycle's attendance figures.";
  const second = "Measure highest risk by the overall risk score from the approved policy.";
  assert.equal(mergeNotes("", first), first);
  assert.equal(mergeNotes(first, second), `${first}\n${second}`);
  assert.equal(mergeNotes(first, ""), first, "an empty box keeps the saved notes");
  assert.equal(mergeNotes(first, first), first, "no duplicate line");
  assert.equal(mergeNotes(first, `${first}\n${second}`), `${first}\n${second}`, "a client resending the history is not doubled");
  const long = Array.from({ length: 30 }, (_, i) => `note ${i} ${"x".repeat(60)}`).reduce((acc, line) => mergeNotes(acc, line), "");
  assert.ok(long.length <= 1000);
  assert.ok(long.endsWith(`note 29 ${"x".repeat(60)}`), "the newest note survives the cap");
});
