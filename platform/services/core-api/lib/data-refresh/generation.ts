/**
 * Which data generation a stored artifact (evidence snapshot, plan, risk analysis)
 * was computed on, and whether that is the generation the app shows today.
 *
 * Data generations are rows in the append-only `data_generations` table; the latest
 * row is current. A refresh revises the figures in place (the previous images stay
 * in `record_changes`), so an artifact is "current" exactly when its evidence was
 * captured at or after the moment the current generation was applied. Artifacts
 * captured before that carry figures the app no longer shows ("earlier figures").
 *
 * Every reader that shows a stored figure next to live data goes through this
 * module, so the rule lives in one place (see tests/data-consistency.test.ts).
 */
import type { PoolClient } from "pg";

/** Label of the data every database started with, before any `data_generations` row. */
export const BASELINE_GENERATION = "seed-v1";
export const EARLIER_FIGURES_LABEL = "Based on earlier figures";
export const STUDENT_REREVIEW_NOTICE =
  "Your mentor will review your plan again with the latest figures.";
/** Prefix of the outcome text written when a plan is withdrawn by a data refresh. */
export const WITHDRAWN_BY_REFRESH_PREFIX = "Superseded by data refresh";

export type GenerationMark = { label: string; createdAt: Date };
export type GenerationClock = {
  /** Oldest first. Empty when no refresh was ever applied (everything is current). */
  marks: GenerationMark[];
  /** Label of the current generation. */
  current: string;
  /** When the current generation was applied; null when no refresh was applied. */
  since: Date | null;
};

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

export function buildClock(
  rows: Array<{ label: string; created_at: Date | string }>,
): GenerationClock {
  const marks = rows
    .map((row) => ({ label: row.label, createdAt: asDate(row.created_at) }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latest = marks[marks.length - 1];
  return {
    marks,
    current: latest?.label ?? BASELINE_GENERATION,
    since: latest?.createdAt ?? null,
  };
}

/** The generation that was current when `at` happened. */
export function generationAt(
  clock: GenerationClock,
  at: Date | string | null | undefined,
): string {
  if (at == null) return clock.current;
  const time = asDate(at).getTime();
  let label = BASELINE_GENERATION;
  for (const mark of clock.marks) if (mark.createdAt.getTime() <= time) label = mark.label;
  return label;
}

/** An artifact with no captured evidence yet (a queued review) is not stale: it will
 * collect today's figures when it runs. */
export function isCurrentEvidence(
  clock: GenerationClock,
  capturedAt: Date | string | null | undefined,
): boolean {
  if (capturedAt == null || clock.since == null) return true;
  return asDate(capturedAt).getTime() >= clock.since.getTime();
}

export type EvidenceStamp = {
  evidence_generation: string;
  evidence_current: boolean;
  evidence_captured_at: Date | string | null;
};

export function stampEvidence<T extends { evidence_captured_at?: Date | string | null }>(
  clock: GenerationClock,
  row: T,
): T & EvidenceStamp {
  const captured = row.evidence_captured_at ?? null;
  return {
    ...row,
    evidence_captured_at: captured,
    evidence_generation: generationAt(clock, captured),
    evidence_current: isCurrentEvidence(clock, captured),
  };
}

/** SQL predicate for "this evidence is current"; `since` is a timestamptz parameter
 * (NULL when no refresh was applied) and `captured` a timestamptz expression. */
export const currentEvidenceSql = (captured: string, since: string) =>
  `(${since}::timestamptz IS NULL OR ${captured} IS NULL OR ${captured} >= ${since}::timestamptz)`;

/** When the evidence behind a support case was captured (latest snapshot). */
export const caseEvidenceCapturedSql = (caseId: string) =>
  `(SELECT max(es.captured_at) FROM evidence_snapshots es WHERE es.support_case_id=${caseId})`;

/** When a review job collected its evidence (stored in the job checkpoint). */
export const jobEvidenceCapturedSql = (checkpoint: string) =>
  `NULLIF(${checkpoint}->>'capturedAt','')::timestamptz`;

export async function loadGenerationClock(client: PoolClient): Promise<GenerationClock> {
  const exists = await client.query<{ present: boolean }>(
    "SELECT to_regclass('data_generations') IS NOT NULL AS present",
  );
  if (!exists.rows[0]?.present) return buildClock([]);
  const rows = await client.query<{ label: string; created_at: Date }>(
    "SELECT label,created_at FROM data_generations ORDER BY created_at",
  );
  return buildClock(rows.rows);
}

/** Staff-facing description of a stamped row. */
export function describeEvidence(stamp: Pick<EvidenceStamp, "evidence_current" | "evidence_generation">): string {
  return stamp.evidence_current ? "Current figures" : EARLIER_FIGURES_LABEL;
}

/** What a student or parent is allowed to see of their support plans: only plans whose
 * evidence is current, and of those only the newest (review R-07): after a second
 * approval the family sees one plan, while the mentor and the department head keep
 * the full history. Anything else is replaced by one calm line. Pure, so the rule
 * can be tested without a database. */
export function guardPlansForFamily<
  T extends {
    visible: boolean;
    evidence_current: boolean;
    intervention_outcome?: string | null;
    created_at?: Date | string | null;
  },
>(rows: T[]): { plans: T[]; notice: string | null } {
  const at = (row: T) => (row.created_at == null ? -Infinity : asDate(row.created_at).getTime());
  // Rows without a time keep their order (the query lists the newest first).
  const newest = rows
    .filter((row) => row.visible && row.evidence_current)
    .reduce<T | undefined>((best, row) => (!best || at(row) > at(best) ? row : best), undefined);
  const plans = newest ? [newest] : [];
  const held = rows.some(
    (row) =>
      (row.visible && !row.evidence_current) ||
      (!row.visible && (row.intervention_outcome ?? "").startsWith(WITHDRAWN_BY_REFRESH_PREFIX)),
  );
  return { plans, notice: held && plans.length === 0 ? STUDENT_REREVIEW_NOTICE : null };
}
