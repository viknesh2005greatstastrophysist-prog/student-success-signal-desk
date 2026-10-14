import assert from "node:assert/strict";
import test from "node:test";
import { scanForIdentifiers } from "../lib/chapter11/egress";

const roster = { names: ["Family account 001", "Asha Kulkarni", "Dr Mira Sen"] };

test("ordinary words from generated parent account names do not block a payload", () => {
  assert.equal(scanForIdentifiers("Describe only the indicators; do not discuss family circumstances.", roster), undefined);
  assert.equal(scanForIdentifiers("Open the account of marks for the course.", roster), undefined);
});

test("real name parts and the whole placeholder name are still blocked", () => {
  assert.equal(scanForIdentifiers("Asha was absent on Monday", roster), "roster_name");
  assert.equal(scanForIdentifiers("Kulkarni needs a follow-up", roster), "roster_name");
  assert.equal(scanForIdentifiers("message for Family account 001", roster), "roster_name");
});
