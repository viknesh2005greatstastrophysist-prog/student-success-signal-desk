import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { demoPolicy, planSkill, type Policy } from "../lib/chapter11/engine";
import {
  buildPlannerAliases,
  plannerTools,
  resolvePlannerOutput,
  runPlanner,
  type PlanningScope,
} from "../lib/chapter11/planner";
import { ModelLimiter } from "../lib/chapter11/provider";
import { groqEndpoint } from "./agent-fixtures";
import {
  hasTools,
  plannerJson,
  route,
  scriptedPlanner,
  startMockOpenAI,
  type MockReply,
} from "./mock-openai-server";

const MENTOR = randomUUID();
const OTHER_MENTOR = randomUUID();
const policy = (extra: Partial<Policy> = {}): Policy => ({ ...demoPolicy, ...extra });
function scope(): PlanningScope {
  const mine = [3, 3, 5, 5, 6, 7, 7, 8, 8, 8].map((semester, i) => ({
    id: randomUUID(),
    semester,
    attendancePct: 90 - i * 5,
    markPct: 80 - i * 3,
    mentorId: MENTOR,
  }));
  const theirs = [{ id: randomUUID(), semester: 4, attendancePct: 40, markPct: 40, mentorId: OTHER_MENTOR }];
  return {
    students: [...mine, ...theirs],
    policies: [
      { id: randomUUID(), facultyId: MENTOR, policy: policy() },
      { id: randomUUID(), facultyId: OTHER_MENTOR, policy: policy({ attendanceMinimum: 80 }) },
    ],
  };
}
const ROSTER = { names: ["Priya Raman"], registers: ["01FE24BCI047"], emails: [], phrases: [] };
async function plan(
  request: string,
  reply: (body: unknown) => MockReply,
  extra: Partial<Parameters<typeof runPlanner>[0]> = {},
) {
  const mock = route(reply);
  const server = await startMockOpenAI({ "/m": mock });
  try {
    const s = extra.scope ?? scope();
    const outcome = await runPlanner({
      request,
      feedback: "",
      scope: s,
      pins: {},
      endpoints: [groqEndpoint(server.url("/m"))],
      roster: ROSTER,
      options: { limiter: new ModelLimiter(), maxWaitMs: 0 },
      ...extra,
    });
    return { outcome, requests: mock.requests, scope: s };
  } finally {
    await server.close();
  }
}

test("three different vague requests each get request-specific questions (at least two)", async () => {
  const asked: Record<string, string[]> = {
    "check my mentees whose attendance dropped this month": [
      "Does 'this month' mean the last 30 days or since the first of the calendar month?",
      "Should 'attendance dropped' be measured against the policy minimum or against last month's figure?",
    ],
    "see which of my students are struggling": [
      "By 'struggling' do you mean low marks, low attendance, or missed LMS work?",
      "Which approved policy defines the threshold for 'struggling' in this review?",
      "Should final-year students be included?",
    ],
    "look at how everyone is doing before the review meeting": [
      "When is the review meeting, and should the plan cover only changes since the last one?",
      "Does 'everyone' include students you mentor informally, or only your assigned mentees?",
    ],
  };
  const anchors: Record<string, RegExp> = {
    "check my mentees whose attendance dropped this month": /this month/,
    "see which of my students are struggling": /struggling/,
    "look at how everyone is doing before the review meeting": /everyone/,
  };
  const results: string[][] = [];
  for (const [request, questions] of Object.entries(asked)) {
    const { outcome } = await plan(request, scriptedPlanner(({ request: r }) => ({ questions: asked[r]! })));
    assert.equal(outcome.summary.mode, "tools");
    const body = planSkill({
      request,
      feedback: "",
      mode: "model",
      ...(outcome.resolution!.studentIds ? { studentIds: outcome.resolution!.studentIds } : {}),
      agentQuestions: outcome.resolution!.questions,
    });
    assert.ok(body.questions.length >= 2, request);
    assert.equal(body.ready, false);
    assert.deepEqual(body.questions.slice(0, questions.length), questions);
    // the questions quote the request's own ambiguous words
    const anchor = anchors[request]!;
    assert.ok(body.questions.filter((q) => anchor.test(q)).length >= 1, request);
    results.push(body.questions);
  }
  assert.equal(new Set(results.flat()).size, results.flat().length, "no question is shared between requests");
});

test("tools return only counts and aliases; the model never sees an id, name or version", async () => {
  const s = scope();
  const aliases = buildPlannerAliases(s);
  const [count, list] = plannerTools(s, aliases);
  const counted = (await count!.run({ filter: { semesterMin: 7 } })) as { total: number; matching: number; aliases: string[]; semesters: unknown[] };
  assert.equal(counted.total, 11);
  assert.equal(counted.matching, 5);
  assert.ok(counted.aliases.every((a) => /^stu-\d+$/.test(a)));
  const listed = JSON.stringify(await list!.run({}));
  assert.match(listed, /"policy":"policy-\d"/);
  const text = JSON.stringify(counted) + listed;
  for (const row of [...s.students, ...s.policies]) assert.ok(!text.includes(row.id));
  assert.ok(!text.includes("CH11-DEMO"));
});

test("an out-of-scope student or policy cannot enter a plan, whatever the model returns", async () => {
  const s = scope();
  const stranger = s.students.find((x) => x.mentorId === OTHER_MENTOR)!;
  const mine = new Set(s.students.filter((x) => x.mentorId === MENTOR).map((x) => x.id));
  const aliases = buildPlannerAliases(s);
  const leaveOut = Object.entries(aliases.students).find(([, id]) => mine.has(id))![0];
  const { outcome, requests } = await plan(
    "review all my mentees",
    scriptedPlanner(({ policyAlias }) => ({
      domain: "attendance",
      policy: policyAlias,
      allMine: true,
      // an unknown alias, a real foreign uuid and a malformed alias
      filter: { exclude: ["stu-999", stranger.id, leaveOut] },
      questions: [`Is ${stranger.id} included in the meeting?`, "Which semester range should the review cover?"],
    })),
    { scope: s, aliases },
  );
  const r = outcome.resolution!;
  assert.ok(r.studentIds!.length > 0);
  assert.ok(r.studentIds!.every((id) => mine.has(id)), "only the policy owner's own students");
  assert.ok(!r.studentIds!.includes(stranger.id));
  assert.equal(r.studentIds!.length, mine.size - 1, "the excluded alias was left out; unknown ones were ignored");
  assert.ok(r.ignored.includes("exclude"));
  // a question carrying an internal id is dropped, the clean one kept
  assert.deepEqual(r.questions, ["Which semester range should the review cover?"]);
  assert.ok(requests.every((q) => !q.raw.includes(stranger.id)));

  // an unknown policy alias is dropped, never guessed
  const unknown = resolvePlannerOutput(plannerJson({ domain: "attendance", policy: "policy-9", allMine: true }), {
    scope: s, aliases: buildPlannerAliases(s), pins: {},
  })!;
  assert.equal(unknown.policyId, undefined);
  assert.ok(unknown.ignored.includes("policy"));
  // the mentor's own pins win over the model
  const pinned = resolvePlannerOutput(plannerJson({ domain: "academic", allMine: true }), {
    scope: s, aliases: buildPlannerAliases(s), pins: { domain: "attendance", studentIds: [s.students[0]!.id] },
  })!;
  assert.equal(pinned.domain, "attendance");
  assert.deepEqual(pinned.studentIds, [s.students[0]!.id]);
});

test("feedback in plain English narrows the existing selection and changes the focus", async () => {
  const s = scope();
  const mine = s.students.filter((x) => x.mentorId === MENTOR);
  const policyId = s.policies[0]!.id;
  const { outcome, requests } = await plan(
    "check my mentees whose attendance dropped",
    scriptedPlanner(({ feedback, policyAlias }) =>
      feedback
        ? { domain: "attendance", policy: policyAlias, basis: "current", filter: { semesterMax: 6 }, questions: [] }
        : { policy: policyAlias, allMine: true, questions: ["Which focus should the review take?", "Does 'dropped' mean below the policy minimum?"] },
    ),
    {
      scope: s,
      feedback: "leave out final-years, focus attendance",
      current: { policyId, studentIds: mine.map((x) => x.id), domain: undefined },
    },
  );
  const r = outcome.resolution!;
  assert.equal(r.domain, "attendance");
  assert.equal(r.policyId, policyId);
  assert.deepEqual(r.questions, []);
  const expected = mine.filter((x) => x.semester <= 6).map((x) => x.id);
  assert.deepEqual([...r.studentIds!].sort(), expected.sort());
  assert.ok(r.studentIds!.length < mine.length);
  assert.deepEqual(r.filter, { semesterMax: 6 });
  // the feedback text is part of the guarded brief
  assert.ok(requests[0]!.raw.includes("leave out final-years"));
});

test("planner fallbacks are labelled: no tool support, an identity in the request, bad output", async () => {
  const unsupported = await plan("check my mentees", (body) =>
    hasTools(body) ? { status: 400, body: { error: { message: "no tools" } } } : { content: "{}" },
  );
  assert.equal(unsupported.outcome.summary.mode, "standard-evidence");
  assert.match(unsupported.outcome.summary.fallbackReason!, /^TOOLS_UNSUPPORTED/);
  assert.equal(unsupported.outcome.resolution, undefined);

  const named = await plan("check on Priya Raman and her attendance", scriptedPlanner(() => ({})));
  assert.equal(named.outcome.summary.fallbackReason, "EGRESS_BLOCKED: roster_name");
  assert.equal(named.requests.length, 0, "the request never left");
  assert.equal(named.outcome.summary.egress[0]!.outcome, "blocked");

  const garbage = await plan("check my mentees", (body) =>
    hasTools(body) ? { content: "ready" } : { content: JSON.stringify({ domain: "chemistry" }) },
  );
  assert.equal(garbage.outcome.summary.mode, "standard-evidence");
  assert.match(garbage.outcome.summary.fallbackReason!, /MODEL_INVALID_OUTPUT/);
  // every fallback leaves the regex parser's questions in force
  const body = planSkill({ request: "check my mentees", feedback: "", mode: "model" });
  assert.equal(body.questions.length, 3);
});

test("the planner module cannot lock, execute or save on its own", () => {
  for (const file of ["planner.ts", "planning.ts"]) {
    const source = readFileSync(new URL(`../lib/chapter11/${file}`, import.meta.url), "utf8");
    assert.ok(!/\blockPlan\b|\bexecutePlan\b|\bsetReviewPaused\b/.test(source), file);
  }
});
