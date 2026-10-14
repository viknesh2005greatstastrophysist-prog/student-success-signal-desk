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

type FailureSummary = {
  fallbacks: Array<{ provider: string; model: string; reason: string }>;
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
