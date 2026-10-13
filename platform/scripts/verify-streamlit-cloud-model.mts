/** Real cloud inference using fictional inputs and private configuration. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { configuredComposer } from "../services/core-api/lib/chapter11/provider";
import {
  compose,
  demoPolicy,
  formatSkill,
  riskAnalysis,
  sourceNames,
  type Evidence,
} from "../services/core-api/lib/chapter11/engine";
const root = fileURLToPath(new URL("../../", import.meta.url));
const env = JSON.parse(
  fs.readFileSync(
    root + "runtime/streamlit-project/cloud-environment.json",
    "utf8",
  ),
);
Object.assign(process.env, env);
const studentId = "11111111-1111-4111-8111-111111111111";
const evidence = Object.fromEntries(
  sourceNames.map((source) => [
    source,
    {
      source,
      studentId,
      recordId: "PRIVATE_FAKE_RECORD",
      observedAt: "2026-10-13T00:00:00.000Z",
      semester: "PRIVATE_FAKE_PERIOD",
      state: "present",
      synthetic: true,
      values:
        source === "academic"
          ? { attendancePct: 50, markPct: 45, privateName: "DO_NOT_SEND_NAME" }
          : source === "lms"
            ? { inactivityDays: 12, overdueAssignments: 1 }
            : source === "internship"
              ? { missedMilestones: 1 }
              : { missedActivities: 1 },
    },
  ]),
) as Evidence;
const risk = riskAnalysis(evidence, demoPolicy),
  context = {
    evidence,
    risk,
    domain: "academic" as const,
    baseline: formatSkill(risk, "academic"),
    references: [],
  };
const native = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, init) => {
  const body = String(init?.body);
  for (const sentinel of [
    studentId,
    "PRIVATE_FAKE_RECORD",
    "PRIVATE_FAKE_PERIOD",
    "DO_NOT_SEND_NAME",
    "attendancePct is 50",
  ])
    assert(!body.includes(sentinel));
  calls++;
  const response = await native(url, init);
  if (!response.ok) {
    let details = await response.clone().text();
    details = details.split(env.CH11_MODEL_API_KEY).join("[REDACTED]");
    fs.writeFileSync(
      root + "runtime/streamlit-project/cloud-model-error.json",
      details,
      { mode: 0o600 },
    );
  }
  return response;
};
const provider = configuredComposer();
assert(provider, "Cloud provider is not configured");
const result = await compose(context, provider);
const report = {
  status: result.mode === "model" ? "passed" : "failed",
  model: result.modelId ?? env.CH11_MODEL,
  actualMode: result.mode,
  actualRequests: calls,
  validation: result.validation.valid,
  providerError: result.validation.providerError,
  anonymousPayload: true,
};
fs.writeFileSync(
  root + "runtime/streamlit-project/cloud-model-acceptance.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
assert.equal(result.mode, "model");
