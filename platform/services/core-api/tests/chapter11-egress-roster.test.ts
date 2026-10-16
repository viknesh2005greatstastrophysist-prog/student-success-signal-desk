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

test("words from the operations service account do not block a payload (final loop: internship role text)", () => {
  const withOps = { names: [...roster.names, "Academic Operations"] };
  assert.equal(scanForIdentifiers("Internship role: operations analyst, academic year 3", withOps), undefined);
  assert.equal(scanForIdentifiers("message for Academic Operations", withOps), "roster_name");
  assert.equal(scanForIdentifiers("Asha was absent on Monday", withOps), "roster_name");
});

test("the pipeline's own word 'alias' does not block a payload when a roster name contains it (16 Oct full run)", () => {
  const withAlias = { names: [...roster.names, "Mohammed Alias Khan"] };
  assert.equal(scanForIdentifiers("Cite each figure by its evidence alias, for example ev-3; the student alias is stu-1.", withAlias), undefined);
  assert.equal(scanForIdentifiers("Mohammed missed two labs", withAlias), "roster_name");
  assert.equal(scanForIdentifiers("follow up with Mohammed Alias Khan", withAlias), "roster_name");
});
