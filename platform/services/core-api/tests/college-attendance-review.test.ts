import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, symlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { once } from "node:events";
import { get } from "node:http";
import { buildCollegeAttendanceReview, readPrivateImportFile } from "../lib/chapter11/college-attendance-review";
import { createCollegeAttendanceServer } from "../lib/chapter11/college-attendance-server";
import { fixture } from "./fixtures/college-attendance";

function inputs() {
  const bundle = fixture();
  const identities = bundle.enrollments.map(row => ({ ...row, studentName: "Example Student", srn: "TEST001" }));
  const context = {
    schemaVersion: "aura.college-source-context.v1", datasetId: bundle.datasetId,
    permission: { status: "user_confirmed", confirmedOn: "2026-09-09", statement: "Fictional test permission", basis: "user_statement" },
    clarification: { zeroMeaning: "unconfirmed", zeroHypothesis: "Not confirmed", naMeaning: null, tnsMeaning: null, numericUnit: null, academicTerm: null, periodStart: null, periodEnd: null },
  };
  return { bundle, identities, context };
}

test("permission permits named review without guessing percentages, absences or risk", () => {
  const { bundle, identities, context } = inputs();
  const view = buildCollegeAttendanceReview(bundle, identities, context);
  assert.equal(view.students[0]!.name, "Example Student");
  assert.equal(view.students[0]!.srn, "TEST001");
  assert.deepEqual(view.students[0]!.reports[0]!.courses.map(c => c.value), [0, "NA", "TNS", 79]);
  assert.equal(view.fullAgentReviewReady, false);
  assert.equal(view.overallRiskScore, null);
  assert.equal("statement" in view.permission, false);
  const altered = structuredClone(context); altered.clarification.zeroMeaning = "no_attendance";
  assert.throws(() => buildCollegeAttendanceReview(bundle, identities, altered));
});

test("reject missing, duplicate or mismatched identities and unrelated source confirmation", () => {
  const { bundle, identities, context } = inputs();
  assert.throws(() => buildCollegeAttendanceReview(bundle, [], context), /Named rows/);
  assert.throws(() => buildCollegeAttendanceReview(bundle, [...identities, ...identities], context), /Named rows/);
  const altered = structuredClone(identities); altered[0]!.semester = 8;
  assert.throws(() => buildCollegeAttendanceReview(bundle, altered, context), /different student or source/);
  assert.throws(() => buildCollegeAttendanceReview(bundle, identities, { ...context, datasetId: "a".repeat(64) }), /different dataset/);
});

test("retain all reports for a student across semesters, including the name as recorded", () => {
  const { bundle, identities, context } = inputs();
  const sourceId = "a".repeat(64), enrollmentId = "b".repeat(64);
  bundle.sources.push({ ...bundle.sources[0]!, id: sourceId, sha256: sourceId, semester: 8 });
  bundle.enrollments.push({ ...bundle.enrollments[0]!, id: enrollmentId, sourceId, semester: 8 });
  bundle.observations.push(...bundle.observations.map((cell, index) => ({ ...cell, id: String(index).repeat(64), sourceId, enrollmentId, semester: 8 })));
  identities.push({ ...identities[0]!, id: enrollmentId, sourceId, semester: 8, studentName: "Example Student Updated" });
  Object.assign(bundle.summary, { sourceFiles: 2, studentRows: 2, studentsInMultipleReports: 1, attendanceCells: 8, numericCells: 4, zeroCells: 2, naCells: 2, tnsCells: 2, verifiedSourceCells: 128 });
  const view = buildCollegeAttendanceReview(bundle, identities, context);
  assert.equal(view.students.length, 1);
  assert.equal(view.students[0]!.reports.length, 2);
  assert.equal(view.students[0]!.reports[1]!.nameAsRecorded, "Example Student Updated");
  identities[1]!.srn = "DIFFERENT";
  assert.throws(() => buildCollegeAttendanceReview(bundle, identities, context), /Conflicting student/);
});

test("private reader rejects paths and symlinks outside the import directory", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "aura-import-test-"));
  try {
    const root = resolve(dir, "private"); await mkdir(root);
    const outside = resolve(dir, "outside.json"), inside = resolve(root, "inside.json");
    await writeFile(outside, "{}"); await writeFile(inside, "{\"test\":true}");
    await symlink(outside, resolve(root, "link.json"));
    assert.deepEqual(await readPrivateImportFile(root, inside), { test: true });
    await assert.rejects(readPrivateImportFile(root, outside), /must stay inside/);
    await assert.rejects(readPrivateImportFile(root, resolve(root, "link.json")), /must stay inside/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("local review is read-only, uncached and rejects foreign hosts and cross-site reads", async () => {
  const { bundle, identities, context } = inputs();
  const server = createCollegeAttendanceServer(buildCollegeAttendanceReview(bundle, identities, context), { html: "Review", script: "", css: "" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const addr = server.address(); assert.ok(addr && typeof addr !== "string");
    assert.equal(addr.address, "127.0.0.1");
    const url = `http://127.0.0.1:${addr.port}`;
    const response = await fetch(`${url}/api/review`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal((await response.json()).students[0].srn, "TEST001");
    // Fetch rewrites Host, so exercise host rejection with an actual HTTP request.
    const foreignHostStatus = await new Promise<number | undefined>((done, reject) => {
      get(`${url}/api/review`, { headers: { host: "foreign.example" } }, response => {
        response.resume(); response.on("end", () => done(response.statusCode));
      }).on("error", reject);
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(`${url}/api/review`, { headers: { origin: "https://foreign.example" } })).status, 403);
    assert.equal((await fetch(`${url}/api/review`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${url}/private-student-records.json`)).status, 404);
    assert.equal((await fetch(`${url}/api/review`, { method: "HEAD" })).status, 200);
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
});
