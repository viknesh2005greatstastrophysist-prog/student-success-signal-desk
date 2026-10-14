import assert from "node:assert/strict";
import test from "node:test";
import { idleTimeoutMs } from "../lib/db";

test("pool idle timeout: 20 s by default, the Streamlit worker may keep connections longer", () => {
  assert.equal(idleTimeoutMs({}), 20_000);
  assert.equal(idleTimeoutMs({ CORE_DB_IDLE_TIMEOUT_MS: "120000" }), 120_000);
});

test("pool idle timeout: anything that is not a sane integer falls back to the default", () => {
  for (const bad of ["", "abc", "0", "999", "600001", "1.5", "-5", "NaN"])
    assert.equal(idleTimeoutMs({ CORE_DB_IDLE_TIMEOUT_MS: bad }), 20_000, bad);
});
