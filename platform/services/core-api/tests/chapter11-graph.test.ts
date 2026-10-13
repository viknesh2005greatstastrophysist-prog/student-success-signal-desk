import assert from "node:assert/strict";
import test from "node:test";
import {
  collectorNodes,
  executeReviewGraph,
  reviewGraph,
  validationRoute,
  type NodeTrace,
} from "../lib/chapter11/graph";
import { specialistRegistry } from "../lib/chapter11/engine";
test("Spec dispatches named stages, source fan-out and a bounded repair back-edge", async () => {
  const trace: NodeTrace = {},
    order: string[] = [];
  const handlers = Object.fromEntries(
    reviewGraph.stages
      .flat()
      .filter((n) => !collectorNodes.includes(n as never))
      .map((n) => [
        n,
        async () => {
          order.push(n);
        },
      ]),
  );
  await executeReviewGraph(
    handlers,
    async (run) => {
      await Promise.all(
        collectorNodes.map((n) => run(n, async () => order.push(n))),
      );
    },
    trace,
  );
  assert.equal(order[0], "Coordinator");
  assert.ok(
    order.indexOf("EvidenceValidator") > order.indexOf("PlacementCollector"),
  );
  assert.equal(order.at(-1), "HumanGate");
  assert.ok(!order.includes("DashboardPublisher"));
  assert.equal(validationRoute(false, 0), "regenerate");
  assert.equal(validationRoute(false, 2), "escalate");
  assert.equal(validationRoute(true, 2), "accept");
  for (const domain of [
    "academic",
    "attendance",
    "wellbeing-referral",
  ] as const)
    assert.ok(specialistRegistry[domain].instruction.length > 30);
});
