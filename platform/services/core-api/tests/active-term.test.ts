import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { FALLBACK_TERM_CODE, activeTermCode } from "../lib/active-term";

// P3-3: evidence reads the active term's code instead of a fixed "2026-ODD". No database:
// a stand-in client answers the one query.
const client = (codes: string[]) => {
  const seen: unknown[][] = [];
  const stub = {
    query: async (sql: string, params: unknown[]) => {
      seen.push([sql, params]);
      return { rows: codes.map((code) => ({ code })) };
    },
  } as unknown as PoolClient;
  return { stub, seen };
};

test("the active term's code is read from terms.active, newest first", async () => {
  const { stub, seen } = client(["2027-EVEN"]);
  assert.equal(await activeTermCode(stub, "g1"), "2027-EVEN");
  const [sql, params] = seen[0]!;
  assert.match(String(sql), /FROM terms WHERE generation_id=\$1 AND active ORDER BY starts_on DESC/);
  assert.deepEqual(params, ["g1"]);
});

test("with no active term the code falls back to the one the data was built with", async () => {
  assert.equal(FALLBACK_TERM_CODE, "2026-ODD");
  assert.equal(await activeTermCode(client([]).stub, "g1"), "2026-ODD");
});
