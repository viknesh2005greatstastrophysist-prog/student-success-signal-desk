/**
 * Fault injection for live testing. Off by default: it reads only the server
 * environment variable `CH11_FAULT_INJECT`, which the test harness sets when it
 * starts its own server. Format: a comma list of `kind` or `kind:count`, for
 * example `draft:1,judge:1`. Each kind fires at most `count` times per process.
 * Every use is recorded in the draft's provenance and in the audit log as
 * "injected for testing", so an injected fault can never pass as a natural one.
 *
 * - `draft`: the first model draft gets one sentence with a number that no
 *   evidence supports, so the deterministic validator fails and the Regenerator
 *   runs with real diagnoses.
 * - `judge`: the judge is called for real, then one dimension of its first
 *   verdict is lowered, so the judge-triggered repair runs.
 */
export type FaultKind = "draft" | "judge";
export const INJECTED_NOTE = "injected for testing";

const used = new Map<FaultKind, number>();

export function takeFault(
  kind: FaultKind,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const spec = env.CH11_FAULT_INJECT;
  if (!spec) return false;
  for (const part of spec.split(",")) {
    const [name, count] = part.trim().split(":");
    if (name !== kind) continue;
    const limit = count === undefined ? 1 : Number(count);
    if (!Number.isInteger(limit) || limit < 1) return false;
    const seen = used.get(kind) ?? 0;
    if (seen >= limit) return false;
    used.set(kind, seen + 1);
    return true;
  }
  return false;
}

export function resetFaults() {
  used.clear();
}

/** One rationale sentence with a figure no evidence supports (validator input). */
export function corruptDraft(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return candidate;
  const draft = candidate as { rationale?: unknown };
  if (!Array.isArray(draft.rationale) || !draft.rationale.length) return candidate;
  const [first, ...rest] = draft.rationale as Array<Record<string, unknown>>;
  if (!first || typeof first.text !== "string") return candidate;
  return {
    ...draft,
    rationale: [
      {
        ...first,
        text: `${first.text.slice(0, 250).trimEnd()} Attendance was 41.7% in course-1.`,
      },
      ...rest,
    ],
  };
}
