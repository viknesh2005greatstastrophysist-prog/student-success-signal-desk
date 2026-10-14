/** Metrics derive from durable checkpoints, immutable artifacts and decisions.
 * An undecided case is excluded from approval-rate and latency denominators. */
export function editDistance(before: unknown, after: unknown): number {
  const a = JSON.stringify(before ?? {}),
    b = JSON.stringify(after ?? {});
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length]!;
}
export type MetricInput = {
  id: string;
  plan_id: string;
  validation?: {
    valid?: boolean;
    repairs?: unknown[];
    fallback?: boolean;
    escalated?: boolean;
    modelAttempts?: unknown[];
    provenance?: { agent?: { toolCalls?: Array<{ status: string }> } | null };
  } | null;
  mode?: string | null;
  status: string;
  first_packet?: unknown;
  approved_packet?: unknown;
  first_created?: string | Date | null;
  decided_at?: string | Date | null;
  decision?: string | null;
  artifact_version?: number | null;
};
const isEscalated = (r: MetricInput) =>
  r.status === "needs_human" || r.validation?.escalated === true;
export function evaluationMetrics(rows: MetricInput[]) {
  const perRun = rows
    .filter((r) => r.validation)
    .map((r) => ({
      jobId: r.id,
      cycleId: r.plan_id,
      validationPassed: r.validation!.valid === true,
      repairsUsed: r.validation!.repairs?.length ?? 0,
      fallback: r.validation!.fallback === true,
      toolCalls: (r.validation!.provenance?.agent?.toolCalls ?? []).filter((c) => c.status === "ok").length,
      toolRefusals: (r.validation!.provenance?.agent?.toolCalls ?? []).filter((c) => c.status !== "ok").length,
      escalated: isEscalated(r),
      mode: r.mode ?? "not recorded",
      decision: r.decision ?? null,
      approveAsIs: r.decision === "approved" ? r.artifact_version === 1 : null,
      mentorEditDistance:
        r.decision === "approved"
          ? editDistance(r.first_packet, r.approved_packet)
          : null,
      timeToDecisionSeconds:
        r.decided_at && r.first_created
          ? Math.max(
              0,
              (new Date(r.decided_at).getTime() -
                new Date(r.first_created).getTime()) /
                1000,
            )
          : null,
    }));
  const cycles = [...new Set(perRun.map((r) => r.cycleId))].map((cycleId) => {
    const r = perRun.filter((r) => r.cycleId === cycleId),
      decided = r.filter((x) => x.decision),
      approved = r.filter((x) => x.decision === "approved");
    return {
      cycleId,
      evaluatedRuns: r.length,
      validationPassRate: r.filter((x) => x.validationPassed).length / r.length,
      repairsUsed: r.reduce((n, x) => n + x.repairsUsed, 0),
      fallbackRate: r.filter((x) => x.fallback).length / r.length,
      escalationRate: r.filter((x) => x.escalated).length / r.length,
      toolCalls: r.reduce((n, x) => n + x.toolCalls, 0),
      toolRefusals: r.reduce((n, x) => n + x.toolRefusals, 0),
      modelRuns: r.filter((x) => x.mode === "model").length,
      /** runs from the retired rule-based path; no new run can be rule-based */
      legacyRuleRuns: r.filter((x) => x.mode === "deterministic").length,
      decidedRuns: decided.length,
      approveAsIsRate: approved.length
        ? approved.filter((x) => x.approveAsIs).length / approved.length
        : null,
      averageMentorEditDistance: approved.length
        ? approved.reduce((n, x) => n + x.mentorEditDistance!, 0) /
          approved.length
        : null,
      averageDecisionSeconds: decided.length
        ? decided.reduce((n, x) => n + (x.timeToDecisionSeconds ?? 0), 0) /
          decided.length
        : null,
    };
  });
  // One set of headline counts for every screen (E2E log #10, #11). Escalations
  // count every escalated job, including ones that stopped before validation;
  // `waiting` jobs are queued and have not started, so they are not recorded runs.
  const totals = {
    jobs: rows.length,
    recorded: rows.filter((r) => r.status !== "queued").length,
    waiting: rows.filter((r) => r.status === "queued").length,
    evaluated: perRun.length,
    validationPassed: perRun.filter((r) => r.validationPassed).length,
    escalated: rows.filter(isEscalated).length,
    escalatedEvaluated: perRun.filter((r) => r.escalated).length,
    repairs: perRun.reduce((n, r) => n + r.repairsUsed, 0),
  };
  return { perRun, cycles, totals };
}
