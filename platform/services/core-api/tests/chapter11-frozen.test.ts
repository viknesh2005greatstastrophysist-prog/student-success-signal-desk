import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { ConflictError } from "../lib/http";
import {
  DEFAULT_FROZEN_CASE_IDS,
  assertCaseNotFrozen,
  frozenCaseIds,
  frozenLeftOutNote,
  frozenRegisterNumbers,
  isFrozenCase,
  isFrozenRegisterNumber,
} from "../lib/chapter11/frozen";
import { decideSupportCase } from "../lib/support-commands";
import { editDraft } from "../lib/chapter11/review";

/** Review R-03: student 021's pending case stays untouched. The lists come from
 * the environment, default to the project's frozen record, and the case check
 * runs before any database access, so these tests need no database. */

const frozenCase = DEFAULT_FROZEN_CASE_IDS[0]!;
const isFrozenError = (error: unknown) =>
  error instanceof ConflictError && error.code === "FROZEN_RECORD" && error.status === 409;

test("frozen lists default to the project record when the variables are unset", () => {
  assert.deepEqual(frozenCaseIds({}), ["d398bbc3-60b1-4843-aabc-4d7f1e0d2a3b"]);
  assert.deepEqual(frozenRegisterNumbers({}), ["01FE23BCI103"]);
  assert.equal(isFrozenCase(frozenCase.toUpperCase(), {}), true);
  assert.equal(isFrozenRegisterNumber(" 01fe23bci103 ", {}), true);
  assert.equal(isFrozenRegisterNumber("01FE23BCI104", {}), false);
  assert.equal(isFrozenCase(randomUUID(), {}), false);
  assert.equal(isFrozenCase(undefined, {}), false);
});

test("frozen lists read comma lists from the environment; an empty value freezes nothing", () => {
  const other = randomUUID();
  const env = { CORE_FROZEN_CASE_IDS: ` ${other} ,, `, CORE_FROZEN_REGISTER_NUMBERS: "a1, B2" };
  assert.deepEqual(frozenCaseIds(env), [other]);
  assert.deepEqual(frozenRegisterNumbers(env), ["A1", "B2"]);
  assert.equal(isFrozenCase(frozenCase, env), false);
  assert.equal(isFrozenRegisterNumber("b2", env), true);
  const none = { CORE_FROZEN_CASE_IDS: "", CORE_FROZEN_REGISTER_NUMBERS: "" };
  assert.deepEqual(frozenCaseIds(none), []);
  assert.deepEqual(frozenRegisterNumbers(none), []);
  assert.doesNotThrow(() => assertCaseNotFrozen(frozenCase, none));
  assert.throws(() => assertCaseNotFrozen(frozenCase, {}), isFrozenError);
});

test("the note on a plan says how many students were left out, without naming them", () => {
  assert.equal(frozenLeftOutNote(1), "1 student was left out: their record is kept unchanged for the project presentation.");
  assert.match(frozenLeftOutNote(2), /^2 students were left out: their records are kept unchanged/);
});

test("a decision or an edit on a frozen case is refused before any database access, for the mentor and the department head alike", async () => {
  const previous = process.env.CORE_FROZEN_CASE_IDS;
  delete process.env.CORE_FROZEN_CASE_IDS;
  try {
    for (const role of ["faculty", "hod"] as const) {
      const mentor: ActorContext = {
        subject: `${role}@aura.invalid`,
        role,
        personId: randomUUID(),
        departmentId: randomUUID(),
      };
      for (const decision of ["approved", "rejected"] as const)
        await assert.rejects(
          () =>
            decideSupportCase(mentor, frozenCase, randomUUID(), {
              artifactId: randomUUID(),
              contentHash: "a".repeat(64),
              expectedRevision: 0,
              decision,
              rationale: "Looks right for this student",
            }),
          isFrozenError,
        );
      await assert.rejects(
        () =>
          editDraft(mentor, frozenCase, randomUUID(), {
            expectedRevision: 0,
            artifactId: randomUUID(),
            packet: {
              summary: "Mentor review requested: attendance low.",
              actions: [{ code: "faculty-check-in", label: "Schedule a 20-minute check-in", owner: "assigned_faculty", dueInDays: 7 }],
              citations: [{ evidencePath: "evidence.academic.values.attendancePct", statement: "attendancePct is 61; threshold 75." }],
              prohibited: [],
            },
            rationale: "Shorter deadline for this week",
          }),
        isFrozenError,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.CORE_FROZEN_CASE_IDS;
    else process.env.CORE_FROZEN_CASE_IDS = previous;
  }
});
