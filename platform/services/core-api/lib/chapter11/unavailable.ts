import { ConflictError } from "../http";

/**
 * Every review and every plan runs on an AI model. When no model answers
 * (none configured, or every provider in the chain failed) nothing is drafted:
 * the work waits as "AI unavailable" for the mentor to retry, and the reasons
 * are audited. There is no rule-based draft or parser to fall back to.
 */
export const AI_UNAVAILABLE = "AI_UNAVAILABLE";

export class AiUnavailableError extends ConflictError {
  constructor(
    message: string,
    /** per-provider reason codes, e.g. "groq qwen/qwen3.8-27b: MODEL_HTTP_429: ..." */
    readonly reasons: string[],
  ) {
    super(AI_UNAVAILABLE, message);
  }
}

/** The model is fine; its quota window is not open yet (#34). An interactive
 * call reports this instead of "AI unavailable": the page shows "Waiting for AI
 * quota, about N s" and retries the same request by itself. */
export const AI_QUOTA_WAIT = "AI_QUOTA_WAIT";

export class QuotaWaitError extends ConflictError {
  constructor(
    readonly retryAfterSeconds: number,
    /** per-provider reason codes, as for AI unavailable */
    readonly reasons: string[],
  ) {
    super(
      AI_QUOTA_WAIT,
      `Waiting for AI quota, about ${retryAfterSeconds} s. The request was not lost; it is retried automatically.`,
    );
  }
}

type FailureSummary = {
  fallbacks: Array<{ provider: string; model: string; reason: string; retryAfterMs?: number }>;
  fallbackReason?: string | null;
  skippedReason?: string;
};

/** Short, secret-free reasons: provider kind, model name and the failure code. */
export function unavailableReasons(summary: FailureSummary): string[] {
  const reasons = summary.fallbacks.map(
    (f) => `${f.provider} ${f.model}: ${f.reason}`.slice(0, 300),
  );
  const extra = summary.fallbackReason ?? summary.skippedReason;
  if (extra && !reasons.some((r) => extra.includes(r) || r.includes(extra)))
    reasons.push(extra.slice(0, 300));
  return reasons.slice(0, 8);
}

/** Seconds until some provider's window admits the call, when that is the only
 * reason no model answered (every failed provider reported a wait). */
export function quotaWaitSeconds(summary: FailureSummary): number | undefined {
  const waits = summary.fallbacks.map((f) => f.retryAfterMs);
  if (!waits.length || waits.some((w) => !w)) return undefined;
  return Math.min(120, Math.ceil(Math.min(...(waits as number[])) / 1000) + 1);
}
