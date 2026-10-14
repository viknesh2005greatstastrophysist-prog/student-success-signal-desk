import { randomUUID } from "node:crypto";
import {
  demoPolicy,
  formatSkillV2,
  riskAnalysis,
  sourceNames,
  type Evidence,
  type GenerationContext,
} from "../lib/chapter11/engine";
import { courseValueKey } from "../lib/chapter11/egress";
import type { InvestigationBackend } from "../lib/chapter11/investigator";
import type { Endpoint } from "../lib/chapter11/provider";

export const STUDENT = randomUUID();
export const ROSTER = {
  names: ["Priya Raman", "Anand Kulkarni"],
  registers: ["01FE24BCI047"],
  emails: ["priya.raman@college.example.edu"],
  phrases: ["Fictional Institute of Technology"],
};

/** Attendance-pattern case: 62% overall, 21CS501 weakest. */
export const attendanceContext = () => caseContext({ attendancePct: 62, markPct: 72, inactivityDays: 2, overdueAssignments: 0 }, "attendance");
/** Academic-pattern case: marks low, LMS overdue; routes to the academic pack. */
export const academicContext = () => caseContext({ attendancePct: 90, markPct: 48, inactivityDays: 10, overdueAssignments: 3 }, "academic");
export function caseContext(
  v: { attendancePct: number; markPct: number; inactivityDays: number; overdueAssignments: number },
  domain: GenerationContext["domain"],
): GenerationContext {
  const values = (source: string) =>
    source === "academic"
      ? {
          attendancePct: v.attendancePct,
          markPct: v.markPct,
          [courseValueKey("attendancePct", "21CS501")]: v.attendancePct - 6,
          [courseValueKey("attendancePct", "21CS502")]: v.attendancePct + 6,
        }
      : source === "lms"
        ? { inactivityDays: v.inactivityDays, overdueAssignments: v.overdueAssignments }
        : source === "internship"
          ? { missedMilestones: 0 }
          : { missedActivities: 0 };
  const evidence = Object.fromEntries(
    sourceNames.map((source) => [
      source,
      {
        source,
        studentId: STUDENT,
        recordId: `SYNTHETIC-${source}`,
        observedAt: new Date().toISOString(),
        semester: "2026-ODD",
        state: "present",
        synthetic: true,
        values: values(source),
      },
    ]),
  ) as unknown as Evidence;
  const risk = riskAnalysis(evidence, demoPolicy);
  return {
    evidence,
    risk,
    domain,
    references: [],
    baseline: formatSkillV2(risk, domain, evidence),
    policy: demoPolicy,
    roster: ROSTER,
  };
}

export function fakeBackend(overrides: Partial<InvestigationBackend> = {}) {
  const hits: string[] = [];
  const backend: InvestigationBackend = {
    async attendance(by) {
      hits.push(`attendance:${by}`);
      return by === "course"
        ? [
            { course: "21CS501", attended: 5, held: 10 },
            { course: "21CS502", attended: 8, held: 10 },
          ]
        : [
            { week: 1, attended: 4, held: 4 },
            { week: 2, attended: 3, held: 4 },
            { week: 3, attended: 1, held: 4 },
            { week: 4, attended: 2, held: 4 },
          ];
    },
    async assessments(component) {
      hits.push(`assessments:${component ?? "*"}`);
      return component
        ? [{ component: `${component}-1`, markPct: 70, count: 1 }]
        : [
            { component: "quiz", markPct: 64.5, count: 3 },
            { component: "lab", markPct: 81, count: 2 },
          ];
    },
    async lmsTimeline(weeks) {
      hits.push(`lms:${weeks}`);
      return Array.from({ length: weeks }, (_, weeksAgo) => ({
        weeksAgo,
        lessonsOpened: weeksAgo === 0 ? 0 : 3,
        submissions: weeksAgo === 0 ? 0 : 1,
      }));
    },
    async internship() {
      hits.push("internship");
      return { missedMilestones: 0 };
    },
    async placement() {
      hits.push("placement");
      return { missedActivities: 0 };
    },
    async similar(k) {
      hits.push(`similar:${k}`);
      return [
        {
          id: randomUUID(),
          text: "Earlier approved support actions: attendance-review faculty-check-in",
          tags: ["attendance"],
          similarity: 0.42,
          embeddingModel: "sha256-lexical-128-v1",
          actionCodes: ["attendance-review", "faculty-check-in"],
        },
      ].slice(0, k);
    },
    ...overrides,
  };
  return { backend, hits };
}

export const groqEndpoint = (base: string): Endpoint => ({
  kind: "groq",
  base,
  model: "qwen/qwen3.8-27b",
  key: "test-key",
  remote: true,
  extra: { reasoning_effort: "none" },
});
