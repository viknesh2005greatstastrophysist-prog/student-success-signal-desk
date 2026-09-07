import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compose, demoPolicy, formatSkill, riskAnalysis, sourceNames, type Evidence } from "../lib/chapter11/engine";
import { configuredComposer } from "../lib/chapter11/provider";

const composer = configuredComposer();
if (!composer) throw new Error("Configure CH11_MODEL and CH11_MODEL_BASE_URL before claiming live-model execution");
const studentId = "00000000-0000-4000-8000-000000000011";
const evidence = Object.fromEntries(sourceNames.map(source => [source, { source, studentId, recordId: `MODEL-CHECK-SYNTHETIC-${source}`, observedAt: new Date().toISOString(), semester: "2026-ODD", state: "present", synthetic: true, values: source === "academic" ? { attendancePct: 65, markPct: 55 } : source === "lms" ? { inactivityDays: 9, overdueAssignments: 2 } : source === "internship" ? { missedMilestones: 0 } : { missedActivities: 0 } }])) as unknown as Evidence;
const risk = riskAnalysis(evidence, demoPolicy);
const start = performance.now();
const result = await compose({ evidence, risk, domain: "academic", references: [], baseline: formatSkill(risk, "academic") }, composer);
const record = { verifiedAt: new Date().toISOString(), synthetic: true, elapsedMs: Math.round(performance.now() - start), ...result };
const directory = resolve("../../artifacts/chapter11");
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "model-check.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ mode: result.mode, modelId: result.modelId, validation: result.validation, elapsedMs: record.elapsedMs }));
if (result.mode !== "model" || !result.validation.valid) process.exitCode = 1;
