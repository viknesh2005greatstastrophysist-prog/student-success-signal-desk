/** This spec drives executor stages and the bounded validation back-edge. */
export const collectorNodes = [
  "ContineoCollector",
  "LMSCollector",
  "InternshipCollector",
  "PlacementCollector",
] as const;
export const specialistNodes = [
  "AcademicSpecialist",
  "AttendanceSpecialist",
  "WellbeingReferralSpecialist",
] as const;
export const reviewGraph = {
  version: "chapter11-graph-v1",
  maxRepairs: 2,
  stages: [
    ["Coordinator"],
    [...collectorNodes],
    ["EvidenceValidator"],
    ["RiskAnalysisAgent"],
    ["HistoryRetriever"],
    ["RecommendationAgent"],
    ["HumanGate"],
  ],
  nodes: [
    "Coordinator",
    ...collectorNodes,
    "EvidenceValidator",
    "RiskAnalysisAgent",
    "HistoryRetriever",
    "RecommendationAgent",
    ...specialistNodes,
    "PacketValidator",
    "Regenerator",
    "HumanGate",
    "DashboardPublisher",
  ],
  edges: [
    ...collectorNodes.map((to) => ({
      from: "Coordinator",
      to,
      condition: "scoped",
    })),
    ...collectorNodes.map((from) => ({
      from,
      to: "EvidenceValidator",
      condition: "snapshot complete",
    })),
    {
      from: "EvidenceValidator",
      to: "RiskAnalysisAgent",
      condition: "evidence valid",
    },
    {
      from: "RiskAnalysisAgent",
      to: "HistoryRetriever",
      condition: "scoped risk",
    },
    {
      from: "HistoryRetriever",
      to: "RecommendationAgent",
      condition: "flagged only",
    },
    {
      from: "RecommendationAgent",
      to: "PacketValidator",
      condition: "candidate",
    },
    ...specialistNodes.map((to) => ({
      from: "RecommendationAgent",
      to,
      condition: "routed by the case's signals (packet-v2)",
    })),
    ...specialistNodes.map((from) => ({
      from,
      to: "PacketValidator",
      condition: "specialist candidate",
    })),
    {
      from: "PacketValidator",
      to: "Regenerator",
      condition: "failed and budget remains",
      maxTraversals: 2,
    },
    {
      from: "Regenerator",
      to: "PacketValidator",
      condition: "changed failing fields",
    },
    {
      from: "PacketValidator",
      to: "HumanGate",
      condition: "valid or budget exhausted",
    },
    {
      from: "HumanGate",
      to: "DashboardPublisher",
      condition: "assigned mentor approves exact current artifact",
    },
  ],
};
export type NodeId =
  | (typeof collectorNodes)[number]
  | "Coordinator"
  | "EvidenceValidator"
  | "RiskAnalysisAgent"
  | "HistoryRetriever"
  | "RecommendationAgent"
  | (typeof specialistNodes)[number]
  | "PacketValidator"
  | "Regenerator"
  | "HumanGate"
  | "DashboardPublisher";
export type NodeState = {
  status:
    "running" | "completed" | "failed" | "waiting" | "escalated" | "cancelled";
  visits: number;
  elapsedMs: number;
};
export type NodeTrace = Partial<Record<NodeId, NodeState>>;
export type RunNode = <T>(id: NodeId, work: () => Promise<T> | T) => Promise<T>;
export function createNodeRunner(trace: NodeTrace): RunNode {
  return async (id, work) => {
    const previous = trace[id];
    trace[id] = {
      status: "running",
      visits: (previous?.visits ?? 0) + 1,
      elapsedMs: previous?.elapsedMs ?? 0,
    };
    const start = performance.now();
    try {
      const result = await work();
      trace[id]!.status =
        result &&
        typeof result === "object" &&
        "valid" in result &&
        result.valid === false
          ? "failed"
          : "completed";
      return result;
    } catch (error) {
      trace[id]!.status = "failed";
      throw error;
    } finally {
      trace[id]!.elapsedMs += performance.now() - start;
    }
  };
}
export function validationRoute(valid: boolean, repairsUsed: number) {
  const edge = reviewGraph.edges.find(
    (e) => e.from === "PacketValidator" && e.to === "Regenerator",
  )!;
  return valid
    ? "accept"
    : repairsUsed < (edge.maxTraversals ?? 0)
      ? "regenerate"
      : "escalate";
}
export async function executeReviewGraph(
  handlers: Partial<Record<NodeId, () => Promise<unknown>>>,
  collect: (run: RunNode) => Promise<void>,
  trace: NodeTrace,
) {
  const run = createNodeRunner(trace);
  let result: unknown;
  for (const stage of reviewGraph.stages) {
    if (
      stage.every((id) =>
        collectorNodes.includes(id as (typeof collectorNodes)[number]),
      )
    ) {
      await collect(run);
      continue;
    }
    for (const id of stage) {
      const handler = handlers[id as NodeId];
      if (!handler) throw new Error(`Missing graph handler: ${id}`);
      result = await run(id as NodeId, handler);
    }
  }
  return result;
}
