/** Headline counts must mean the same thing on every screen (E2E log fix pass B:
 * #1, #2, #6, #9, #10, #11). Pure functions, no database. */
import assert from "node:assert/strict";
import test from "node:test";
import { collapseAwaiting, type AwaitingDraft } from "../lib/chapter11/awaiting";
import { compositeRiskView } from "../lib/chapter11/dashboard";
import { evaluationMetrics } from "../lib/chapter11/metrics";

const draft = (case_id: string, student_id: string, day: number): AwaitingDraft => ({
  case_id,
  student_id,
  opened_at: `2026-10-${String(day).padStart(2, "0")}T09:00:00Z`,
  run_id: `run-${case_id}`,
  artifact_id: `art-${case_id}`,
  artifact_version: 1,
  drafted_at: `2026-10-${String(day).padStart(2, "0")}T09:05:00Z`,
});

test("awaiting drafts collapse to one per student, newest current, the rest kept as history", () => {
  const groups = collapseAwaiting([
    draft("old", "ada", 10),
    draft("only", "bob", 11),
    draft("new", "ada", 13),
    draft("mid", "ada", 12),
  ]);
  assert.equal(groups.length, 2, "one entry per student, so the count is a count of students");
  const ada = groups.find((g) => g.current.student_id === "ada")!;
  assert.equal(ada.current.case_id, "new");
  assert.deepEqual(ada.earlier.map((e) => e.case_id), ["mid", "old"], "history is newest first and still reachable");
  assert.equal(groups[0]!.current.case_id, "new", "the queue lists the most recent draft first");
  assert.deepEqual(collapseAwaiting([]), []);
});

test("risk view marks one latest row per student so students are not counted once per cycle", () => {
  const risk = { score: 80, band: "high", flagged: true, signals: [], policyVersion: "v1" } as never;
  const students = [
    { id: "a", display_name: "A", register_number: "R1" },
    { id: "b", display_name: "B", register_number: "R2" },
  ];
  // newest first, as the Core returns them
  const rows = compositeRiskView(students, [
    { id: "a-queued", plan_id: "p3", student_id: "a", status: "queued", stage: "collect", created_at: "2026-10-14T00:00:00Z" },
    { id: "a-new", plan_id: "p2", student_id: "a", status: "awaiting_faculty", stage: "complete", created_at: "2026-10-13T00:00:00Z", risk },
    { id: "a-old", plan_id: "p1", student_id: "a", status: "awaiting_faculty", stage: "complete", created_at: "2026-10-12T00:00:00Z", risk },
    { id: "b-queued", plan_id: "p3", student_id: "b", status: "queued", stage: "collect", created_at: "2026-10-14T00:00:00Z" },
  ]);
  assert.equal(rows.length, 4, "every cycle row is still available");
  const latest = rows.filter((r) => r.latest);
  assert.equal(latest.length, 2, "two students, two latest rows");
  assert.equal(latest.find((r) => r.studentId === "a")!.jobId, "a-new", "latest evaluated cycle beats a newer queued one");
  assert.equal(latest.find((r) => r.studentId === "b")!.jobId, "b-queued", "an unevaluated student keeps their newest row");
});

test("evaluation totals give the header and the Evaluation tab the same counts", () => {
  const base = { plan_id: "c", mode: "model" };
  const m = evaluationMetrics([
    { ...base, id: "ok", status: "awaiting_faculty", validation: { valid: true } },
    { ...base, id: "bad", status: "needs_human", validation: { valid: false, escalated: true } },
    // escalated before it reached validation: counted once, in the totals only
    { ...base, id: "stopped", status: "needs_human" },
    { ...base, id: "waiting", status: "queued" },
  ]);
  assert.deepEqual(
    { recorded: m.totals.recorded, waiting: m.totals.waiting, evaluated: m.totals.evaluated, passed: m.totals.validationPassed, escalated: m.totals.escalated },
    { recorded: 3, waiting: 1, evaluated: 2, passed: 1, escalated: 2 },
  );
  assert.equal(m.totals.escalatedEvaluated, 1);
  assert.equal(m.cycles[0]!.validationPassRate, 0.5, "a failing cycle is visible next to the overall rate");
});
