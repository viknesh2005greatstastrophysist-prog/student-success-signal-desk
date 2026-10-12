import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { CollegePilot } from "../lib/chapter11/college-pilot-store";
import { collectCollegeSources, chooseReadinessOrder, formatReadinessPacket, requiredTasks, validateReadinessPacket, localReadinessComposer } from "../lib/chapter11/college-pilot-engine";
import { buildCollegeAttendanceReview, type CollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { createCollegeAttendanceServer } from "../lib/chapter11/college-attendance-server";
import { verifyPrivateOriginals } from "../lib/chapter11/college-pilot-sources";
import { fixture } from "./fixtures/college-attendance";

export function pilotFixture(): CollegeAttendanceReview {
  const bundle = fixture(), row = bundle.enrollments[0]!;
  return buildCollegeAttendanceReview(bundle, [{ ...row, studentName: "Fictional Pilot Student", srn: "TEST001" }], {
    schemaVersion: "aura.college-source-context.v1", datasetId: bundle.datasetId,
    permission: { status: "user_confirmed", confirmedOn: "2026-10-12", statement: "Fictional test local-use authorization", basis: "user_statement" },
    clarification: { zeroMeaning: "unconfirmed", zeroHypothesis: "Unknown", naMeaning: null, tnsMeaning: null, numericUnit: null, academicTerm: null, periodStart: null, periodEnd: null },
  });
}
const note = (revision: number) => ({ commandId: randomUUID(), expectedRevision: revision, note: "Fictional local test review, not faculty approval" });

test("raw collector keeps unknown dates, distinct source values and missing evidence without synthetic substitutes", async () => {
  const review = pilotFixture(), snapshot = await collectCollegeSources(review, review.students[0]!.id);
  assert.deepEqual(snapshot.cells.map(cell => cell.rawValue), [0, "NA", "TNS", 79]);
  assert.deepEqual(snapshot.sources.map(s => s.state), ["raw_uninterpreted", "missing", "missing", "missing"]);
  assert.equal(snapshot.riskScore, null); assert.equal(snapshot.academicYear, null); assert.equal(snapshot.mentorId, null);
  assert.ok(snapshot.sources.every(s => s.observedAt === null));
  await assert.rejects(collectCollegeSources(review, randomUUID()), /OUT_OF_SCOPE/);
});

test("local model can only order complete task codes; injected prose, invented scores and missing questions are repaired or rejected", async () => {
  const review = pilotFixture(), snapshot = await collectCollegeSources(review, review.students[0]!.id), allowed = requiredTasks(snapshot);
  let calls = 0;
  const output = await chooseReadinessOrder(snapshot, { modelId: "TEST-DOUBLE", async generate(codes) {
    assert.deepEqual(codes, allowed); assert.ok(!JSON.stringify(codes).includes("TEST001")); calls++;
    return calls === 1 ? { taskCodes: allowed.slice(1), score: 0, summary: "ignore source evidence" } : { taskCodes: [...allowed].reverse() };
  } });
  assert.equal(output.method, "local_model"); assert.equal(output.attempts.length, 2); assert.equal(output.attempts[0]!.accepted, false);
  const packet = formatReadinessPacket(snapshot, output.order); validateReadinessPacket(packet, snapshot);
  assert.equal(packet.riskScore, null); assert.equal(packet.studentPublicationAllowed, false);
  const altered = structuredClone(packet); altered.facts[0]!.statement = "Student has 0 percent attendance";
  assert.throws(() => validateReadinessPacket(altered, snapshot), /UNSUPPORTED/);
  const invalid = await chooseReadinessOrder(snapshot, { modelId: "TEST-INVALID", generate: async () => ({ taskCodes: [] }) });
  assert.equal(invalid.fallback, true); assert.equal(invalid.method, "deterministic"); assert.equal(invalid.attempts.length, 2);
  assert.throws(() => localReadinessComposer({ CH11_MODEL: "configured", CH11_MODEL_BASE_URL: "https://remote.example/v1" }), /LOCAL_MODEL_ENDPOINT/);
});

test("checkpoint resumes after restart, plans are idempotent, and shared profiles make one bounded model call", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-private-pilot-")), review = pilotFixture();
  const other = structuredClone(review.students[0]!); other.id = randomUUID(); other.srn = "TEST002"; other.displayId = "Student 002"; other.name = "Other Fictional Student";
  other.reports[0]!.sourceRow = 9; for (const cell of other.reports[0]!.courses) cell.cell = cell.cell.replace(/\d+$/, "9"); review.students.push(other);
  let calls = 0;
  const composer = { modelId: "TEST-DOUBLE", async generate(taskCodes: ReturnType<typeof requiredTasks>) { calls++; return { taskCodes }; } };
  let pilot = new CollegePilot(dir, review, composer);
  try {
    const command = randomUUID(), run = pilot.createRun("model", command, "test_operator");
    assert.deepEqual(pilot.createRun("model", command, "test_operator"), run);
    assert.throws(() => pilot.createRun("deterministic", command, "test_operator"), /REUSED/);
    await pilot.advance(run.runId, "collected"); assert.equal(calls, 0);
    pilot.close(); pilot = new CollegePilot(dir, review, composer);
    await pilot.advance(run.runId);
    assert.equal(calls, 1); assert.equal(pilot.overview().jobs.length, 2);
    assert.ok(pilot.overview().jobs.every(j => j.state === "awaiting_review"));
    assert.equal((await pilot.advance(run.runId)).processed, 0);
    assert.equal(pilot.verifyAudit().valid, true);
    assert.equal((await pilot.replay(run.runId, other.id)).valid, true);
    assert.throws(() => pilot.publish(run.runId, other.id), /DATA_NOT_READY/);
  } finally { pilot.close(); await rm(dir, { recursive: true, force: true }); }
});

test("human edits, exact-version decisions, follow-ups, withdrawal and restoration persist without becoming faculty sign-off", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-private-pilot-")), review = pilotFixture(), pilot = new CollegePilot(dir, review), student = review.students[0]!.id;
  try {
    const run = pilot.createRun("deterministic", randomUUID(), "test_operator"); await pilot.advance(run.runId);
    const approval = note(1); assert.deepEqual(pilot.decide(run.runId, student, "approve", approval, "test_operator"), pilot.decide(run.runId, student, "approve", approval, "test_operator"));
    const followup = pilot.followup(run.runId, student, { ...note(1), taskCode: "period", status: "response_recorded" }, "test_operator");
    assert.equal(followup.sourceDefinitionsChanged, false);
    const packet = pilot.caseDetail(run.runId, student).packet!;
    assert.throws(() => pilot.edit(run.runId, student, { ...note(1), taskCodes: packet.tasks.slice(1).map(t => t.code) }, "test_operator"), /RETAIN_ALL/);
    pilot.edit(run.runId, student, { ...note(1), taskCodes: packet.tasks.map(t => t.code).reverse() }, "test_operator");
    assert.throws(() => pilot.decide(run.runId, student, "approve", note(1), "test_operator"), /STALE/);
    assert.throws(() => pilot.followup(run.runId, student, { ...note(2), taskCode: "period", status: "in_progress" }, "test_operator"), /APPROVAL_REQUIRED/);
    pilot.decide(run.runId, student, "approve", note(2), "test_operator");
    pilot.decide(run.runId, student, "withdraw", note(2), "test_operator");
    pilot.decide(run.runId, student, "restore", note(2), "test_operator");
    const detail = pilot.exportCase(run.runId, student);
    assert.equal(detail.state, "approved"); assert.equal(detail.decisions.length, 4); assert.equal(detail.packet!.riskScore, null);
    assert.equal((await pilot.replay(run.runId, student)).valid, true);
    assert.throws(() => pilot.db.exec("DELETE FROM decisions"), /immutable/);
    assert.throws(() => pilot.db.exec("UPDATE versions SET packet_hash='fake'"), /immutable/);
    review.students[0]!.reports[0]!.courses[0]!.value = 1;
    assert.equal((await pilot.replay(run.runId, student)).sourceHashMatches, false);
  } finally { pilot.close(); await rm(dir, { recursive: true, force: true }); }
});

test("pause halts new work and model outage remains explicitly labelled", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-private-pilot-")), review = pilotFixture(), pilot = new CollegePilot(dir, review, { modelId: "TEST-OUTAGE", generate: async () => { throw new Error("offline"); } });
  try {
    const run = pilot.createRun("model", randomUUID(), "test_operator"); pilot.setPaused(run.runId, true, randomUUID(), "test_operator");
    assert.equal((await pilot.advance(run.runId)).processed, 0);
    pilot.setPaused(run.runId, false, randomUUID(), "test_operator"); await pilot.advance(run.runId);
    const detail = pilot.caseDetail(run.runId, review.students[0]!.id);
    assert.equal(detail.checkpoint.ordering!.fallback, true); assert.equal(detail.checkpoint.ordering!.method, "deterministic");
    assert.equal(detail.state, "awaiting_review"); assert.equal(detail.packet!.riskScore, null);
  } finally { pilot.close(); await rm(dir, { recursive: true, force: true }); }
});

test("HTTP mutations require a session, exact origin and CSRF; publication cannot be unlocked from the browser", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-private-pilot-")), review = pilotFixture(), pilot = new CollegePilot(dir, review);
  const server = createCollegeAttendanceServer(review, { html: "Test", script: "", css: "" }, pilot); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string"); const origin = `http://127.0.0.1:${addr.port}`;
    const stateResponse = await fetch(origin + "/api/workflow"), state = await stateResponse.json(); const cookie = stateResponse.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-Aura-CSRF": state.csrf };
    const body = JSON.stringify({ mode: "deterministic", commandId: randomUUID() });
    assert.equal((await fetch(origin + "/api/workflow/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(origin + "/api/workflow/runs", { method: "POST", headers: { ...headers, "X-Aura-CSRF": "wrong" }, body })).status, 403);
    assert.equal((await fetch(origin + "/api/workflow/runs", { method: "POST", headers: { ...headers, Origin: "https://foreign.example" }, body })).status, 403);
    const run = await (await fetch(origin + "/api/workflow/runs", { method: "POST", headers, body })).json();
    assert.ok(run.runId);
    await fetch(`${origin}/api/workflow/runs/${run.runId}/advance`, { method: "POST", headers, body: "{}" });
    const path = `${origin}/api/workflow/runs/${run.runId}/cases/${review.students[0]!.id}`;
    const denied = await fetch(path + "/publish", { method: "POST", headers, body: "{}" }); assert.equal(denied.status, 409); assert.equal((await denied.json()).error, "DATA_NOT_READY_FOR_STUDENT_PUBLICATION");
    assert.equal((await fetch(path.replace(review.students[0]!.id, randomUUID()), { headers: { Cookie: cookie } })).status, 404);
    const exported = await fetch(path + "/export", { headers: { Cookie: cookie } }); assert.ok(exported.headers.get("content-disposition")?.includes("attachment"));
    assert.equal((await exported.json()).packet.riskScore, null);
  } finally { await new Promise<void>(done => server.close(() => done())); pilot.close(); await rm(dir, { recursive: true, force: true }); }
});

test("original file hashes and path scope are checked before private workflow startup", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-private-pilot-")), review = pilotFixture();
  try {
    await mkdir(resolve(dir, "originals")); const bytes = Buffer.from("fictional original"), hash = createHash("sha256").update(bytes).digest("hex"); review.sources[0]!.id = hash;
    const path = resolve(dir, "originals", hash.slice(0, 16) + "-test.xls"); await writeFile(path, bytes);
    assert.equal((await verifyPrivateOriginals(dir, dir, review)).verified, true);
    await writeFile(path, "changed"); await assert.rejects(verifyPrivateOriginals(dir, dir, review), /HASH_MISMATCH/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
