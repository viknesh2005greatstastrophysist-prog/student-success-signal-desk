import assert from "node:assert/strict";
import test from "node:test";
import {
  anonymousPriorReference,
  createSourceRegistry,
} from "../lib/chapter11/connectors";
import { anonymousModelContext } from "../lib/chapter11/provider";
import {
  demoPolicy,
  formatSkill,
  retrieve,
  riskAnalysis,
  type Evidence,
  type Source,
} from "../lib/chapter11/engine";
test("Adapter replacement is independent of agents and prior tags reflect the earlier action", async () => {
  const registry = createSourceRegistry(
    async () => ({ recordId: "original" }) as Source,
  );
  const previous = registry.replace(
    "academic",
    async () => ({ recordId: "swapped" }) as Source,
  );
  assert.equal(
    (await registry.read({} as never, "student", "academic")).recordId,
    "swapped",
  );
  registry.replace("academic", previous);
  assert.equal(
    (await registry.read({} as never, "student", "academic")).recordId,
    "original",
  );
  const prior = anonymousPriorReference(
    "private-case",
    ["attendance-review", "unknown-private-name"],
    "department",
  );
  assert.deepEqual(prior.tags, ["attendance"]);
  assert.ok(!prior.text.includes("unknown-private-name"));
  const ranked = retrieve(
    "attendance support",
    ["attendance"],
    [prior],
    "department",
    "different-student",
  );
  assert.equal(ranked.length, 1);
  const e = {
    academic: {
      studentId: "student",
      state: "present",
      values: { attendancePct: 50, markPct: 50 },
    },
    lms: { studentId: "student", state: "not_applicable" },
    internship: { studentId: "student", state: "not_applicable" },
    placement: { studentId: "student", state: "not_applicable" },
  } as unknown as Evidence;
  const risk = riskAnalysis(e, demoPolicy),
    baseline = formatSkill(risk, "attendance");
  const context = anonymousModelContext({
    evidence: e,
    risk,
    baseline,
    domain: "attendance",
    references: ranked,
  });
  assert.equal(context.references.length, 1);
  assert.ok(context.references[0]!.summary.includes("attendance"));
  assert.ok(!JSON.stringify(context).includes("private-case"));
});
