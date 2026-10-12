import { realpath, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
process.umask(0o077);
const url = new URL(process.argv[2] ?? "http://127.0.0.1:3503");
if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Use the private local workflow only");
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../../runtime/college-attendance"));
const output = await realpath(process.argv[3] ?? "../runtime/college-attendance/2026-10-12");
const location = relative(root, output); if (location.startsWith("..") || isAbsolute(location)) throw new Error("Private evidence output required");
const response = await fetch(new URL("/api/workflow", url)), initial = await response.json();
const cookie = response.headers.get("set-cookie")?.split(";")[0];
if (!response.ok || !cookie || !initial.csrf) throw new Error("Could not open a private operator session");
const headers = { Cookie: cookie, Origin: url.origin, "Content-Type": "application/json", "X-Aura-CSRF": initial.csrf };
async function api(path, body) {
  const result = await fetch(new URL(`/api/workflow${path}`, url), body === undefined ? { headers: { Cookie: cookie } } : { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await result.json(); if (!result.ok) throw new Error(payload.error || "Private workflow failed"); return payload;
}
let runId = initial.runs.find(r => r.mode === "model")?.id;
if (!runId || process.argv.includes("--new")) runId = (await api("/runs", { mode: "model", commandId: randomUUID() })).runId;
let batches = 0, state;
while (true) {
  const progress = await api(`/runs/${runId}/advance`, {}); batches++;
  state = await api("");
  const queued = state.jobs.filter(j => j.run_id === runId && ["queued", "processing"].includes(j.state)).length;
  if (batches % 10 === 0) console.log(JSON.stringify({ batches, remaining: queued }));
  if (progress.paused || progress.busy) throw new Error("Run paused or already processing; resume explicitly");
  if (!queued) break;
  if (!progress.processed) throw new Error("Run contains leased work; resume after the recorded lease expires");
}
const jobs = state.jobs.filter(j => j.run_id === runId), cases = [], totals = {};
for (const job of jobs) {
  totals[job.state] = (totals[job.state] || 0) + 1;
  const detail = await api(`/runs/${runId}/cases/${job.student_id}`);
  assert.equal(detail.state, "awaiting_review"); assert.equal(detail.packet.riskScore, null); assert.equal(detail.packet.mentorId, null);
  assert.equal(detail.packet.studentPublicationAllowed, false); assert.equal(detail.decisions.length, 0);
  cases.push({ studentId: job.student_id, revision: job.revision, packetHash: detail.packetHash, hasCie: detail.checkpoint.snapshot.hasCie,
    method: detail.checkpoint.ordering.method, fallback: detail.checkpoint.ordering.fallback, unknowns: detail.packet.unknowns.length });
}
const representative = [cases.find(c => c.hasCie), cases.find(c => !c.hasCie)].filter(Boolean), replays = [];
for (const item of representative) { const replay = await api(`/runs/${runId}/cases/${item.studentId}/replay`, {}); assert.equal(replay.valid, true); replays.push({ studentId: item.studentId, ...replay }); }
assert.equal(state.audit.valid, true);
const report = { status: "passed", runId, datasetHash: state.datasetHash, preparedStudents: jobs.length, totals,
  actualModelProfiles: state.modelProfiles.filter(p => p.method === "local_model" && !p.fallback).length,
  modelId: state.model, actualModelAttempts: state.modelProfiles.reduce((n, p) => n + p.attempts.length, 0),
  modelInput: "predefined question codes and descriptions only; no identifiers, names, marks or raw source records",
  cases, representativeReplays: replays, audit: state.audit, actualMentorApprovals: 0, actualUserLoginsVerified: 0,
  studentRiskCalculated: false, studentSupportPublished: false, productionDeployed: false };
await writeFile(resolve(output, "pilot-cohort-execution.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ ...report, cases: `${cases.length} private case hashes retained`, representativeReplays: replays.length }));
