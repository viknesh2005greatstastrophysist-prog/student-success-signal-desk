import type { PoolClient } from "pg";

/** The term code the project data was built with, used when no term is active. */
export const FALLBACK_TERM_CODE = "2026-ODD";

/**
 * The active term's code (`terms.active`), the newest when several are active
 * (P3-3). Evidence, the planner's figures and the students' attendance figure read
 * records of this term only. With no active term the code falls back to
 * FALLBACK_TERM_CODE and, as before, no records match (they also require an
 * active term).
 */
export async function activeTermCode(client: PoolClient, generation: string): Promise<string> {
  const row = await client.query<{ code: string }>(
    "SELECT code FROM terms WHERE generation_id=$1 AND active ORDER BY starts_on DESC,code LIMIT 1",
    [generation],
  );
  return row.rows[0]?.code ?? FALLBACK_TERM_CODE;
}
