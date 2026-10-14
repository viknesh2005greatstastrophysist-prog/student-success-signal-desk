/** Lease and best-effort helpers for the review executor (Phase 0.8). Pure: no
 * database access, so they can be exercised with stubs. */

/** Renewal interval; must stay well under the 180 s job lease set by the claim. */
export const LEASE_HEARTBEAT_MS = 60_000;

const logFailure = (what: string, error: unknown) =>
  console.error(
    `${what}: ${error instanceof Error ? error.message : "unknown error"}`,
  );

export type LeaseHeartbeat = { stop(): void };

/** Calls `renew` every `intervalMs` until stopped. `renew` resolves false when the
 * lease is gone (the heartbeat then stops itself). A renewal error is logged and
 * retried on the next tick; the timer never keeps the process alive, and a slow
 * renewal is never overlapped by the next one. */
export function startLeaseHeartbeat(
  renew: () => Promise<boolean>,
  intervalMs: number = LEASE_HEARTBEAT_MS,
  onError: (error: unknown) => void = (error) =>
    logFailure("Lease renewal failed; will retry", error),
): LeaseHeartbeat {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    Promise.resolve()
      .then(renew)
      .then(
        (renewed) => {
          if (!renewed) stop();
        },
        (error) => onError(error),
      )
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref();
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return { stop };
}

/** Persist the state change first (errors propagate); then run the audit write in
 * its own step and only log if it fails, so an audit fault can never roll back
 * or mask the state change. Returns whether the state change applied. */
export async function persistThenAudit(
  persist: () => Promise<boolean>,
  audit: () => Promise<void>,
  onAuditError: (error: unknown) => void = (error) =>
    logFailure("Audit write failed after the job state was saved", error),
): Promise<boolean> {
  const persisted = await persist();
  if (persisted) {
    try {
      await audit();
    } catch (error) {
      onAuditError(error);
    }
  }
  return persisted;
}
