import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectSources, compose, demoPolicy, digest, domainNames, formatSkill, parallelMap, planInputSchema, planSkill, referenceLibrary, retrieve, riskAnalysis, sourceNames, validateEvidence, type Evidence } from "../lib/chapter11/engine";
import { configuredComposer } from "../lib/chapter11/provider";

// Reproducible, credential-free lab build. The authenticated portal journey
// separately proves database persistence, identity and mentor publication.
const generatedAt = new Date().toISOString();
const model = process.argv.includes("--model") ? configuredComposer() : undefined;
if (process.argv.includes("--model") && !model) throw new Error("Requested model is not configured");
const students = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const plans = domainNames.map(domain => {
  const body = planSkill(planInputSchema.parse({ request: "Build a synthetic cohort acceptance artifact", studentIds: students, domain, policyId: "00000000-0000-4000-8000-000000000099" }));
  return { body, planHash: digest(body), locked: body.ready, policyAuthority: "Synthetic fixture only; no institutional approval claimed" };
});
const fixtures = new Map(students.map((studentId, i) => [studentId, Object.fromEntries(sourceNames.map(source => [source, {
  source, studentId, recordId: `SYNTHETIC-BUILD-${i}-${source}`, observedAt: generatedAt, semester: "2026-ODD", state: "present", synthetic: true,
  values: source === "academic" ? { attendancePct: i % 2 ? 90 : 65, markPct: i % 2 ? 80 : 55 } : source === "lms" ? { inactivityDays: i % 2 ? 2 : 9, overdueAssignments: i % 2 ? 0 : 2 } : source === "internship" ? { missedMilestones: 0 } : { missedActivities: 0 },
}])) as unknown as Evidence]));
async function worker(studentId: string) {
  const evidence = await collectSources({ read: async (id, name) => {
    await new Promise(resolve => setTimeout(resolve, 20)); // Declared controlled I/O benchmark.
    return fixtures.get(id)![name];
  } }, studentId);
  validateEvidence(evidence, studentId, demoPolicy, generatedAt, "2026-ODD");
  const risk = riskAnalysis(evidence, demoPolicy);
  const outputs = await Promise.all(domainNames.map(async domain => ({ domain, ...await compose({ evidence, risk, domain, baseline: formatSkill(risk, domain), references: retrieve(domain, [domain], referenceLibrary, "synthetic-department", studentId) }) })));
  return { studentId, evidence, risk, outputs };
}
const start = performance.now();
const sequential = await parallelMap(students, 1, worker);
const sequentialMs = performance.now() - start;
const parallelStart = performance.now();
const parallel = await parallelMap(students, 4, worker);
const parallelMs = performance.now() - parallelStart;
const sameQuality = digest(sequential) === digest(parallel);
let liveModel = null;
if (model) {
  const first = sequential[0]!;
  liveModel = await compose({ evidence: first.evidence, risk: first.risk, domain: "academic", baseline: formatSkill(first.risk, "academic"), references: [] }, model);
}
const accepted = sameQuality && parallel.every(r => r.outputs.every(o => o.validation.valid)) && (!model || liveModel?.mode === "model");
const report = { generatedAt, synthetic: true, accepted, plans, policy: demoPolicy, inputHash: digest([...fixtures]), outputHash: digest(parallel), benchmark: { kind: "controlled 20ms source I/O; not production latency", sequentialMs, parallelMs, sameQuality, students: students.length, concurrency: 4 }, liveModel, results: parallel, publication: "No publication. A passing artifact still requires authenticated mentor approval." };
const directory = resolve("../../artifacts/chapter11");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "build-acceptance.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ accepted, benchmark: report.benchmark, artifact: resolve(directory, "build-acceptance.json") }, null, 2));
if (!accepted) process.exitCode = 1;
