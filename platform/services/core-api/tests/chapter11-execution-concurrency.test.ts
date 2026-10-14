import assert from "node:assert/strict";
import test from "node:test";
import { executionConcurrency, type Endpoint } from "../lib/chapter11/provider";

/** E2E log #33: with a budgeted remote model the reviews of one plan run one at a time, so the
 * tokens-per-minute window is not spent by four investigators before any draft is made. */
const remote = (kind: Endpoint["kind"]): Endpoint => ({ kind, base: "https://example.invalid/v1", model: "m", key: "k", remote: true, extra: {} });
const local: Endpoint = { kind: "local", base: "http://127.0.0.1:1/v1", model: "m", remote: false, extra: {} };

test("a remote model with a token budget runs the reviews one at a time", () => {
  assert.equal(executionConcurrency(4, [remote("groq")]), 1);
  assert.equal(executionConcurrency(4, [remote("gemini")]), 1);
  assert.equal(executionConcurrency(4, [local, remote("groq")]), 1, "any budgeted remote endpoint in the chain is enough");
});

test("a local model, or none, keeps the plan's own concurrency", () => {
  assert.equal(executionConcurrency(4, [local]), 4);
  assert.equal(executionConcurrency(3, []), 3);
});
