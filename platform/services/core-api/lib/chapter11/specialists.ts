import type { ActionCode, DomainName } from "./catalogue";

/**
 * Specialist registry (Brief 15, folded into Brief 11). Each pack has its own
 * system prompt, catalogue subset, view of the evidence and extra output
 * checks. The coordinator routes a case to one pack by its signals.
 */
export type SpecialistNode =
  | "AcademicSpecialist"
  | "AttendanceSpecialist"
  | "WellbeingReferralSpecialist";
export type SpecialistPack = {
  node: SpecialistNode;
  codes: ActionCode[];
  /** the original Chapter 11 instruction (kept verbatim) */
  instruction: string;
  /** pack-specific guidance appended to the shared drafting rules */
  systemPrompt: string;
  /** "triggering" packs see only the evidence behind the triggering signals */
  evidenceView: "full" | "triggering";
  /** may the pack see anonymised prior interventions and guidance? */
  history: boolean;
  /** extra language rule applied to every model-written sentence */
  language?: RegExp;
};

export const WELLBEING_LANGUAGE =
  /\b(anxi\w*|stress(?:ed|ful)?|mental|disorder|condition|ill(?:ness)?|trauma\w*|burn(?:ed|t)?[- ]?out|lazy|unmotivated|motivation|home (?:life|problems?|issues?)|family (?:problems?|issues?|situation)|personal (?:problems?|issues?)|struggl\w*|suffer\w*|symptom\w*|therap\w*|medicat\w*|crisis|self[- ]?harm|addict\w*|substance|lonel\w*|isolat\w*|vulnerable|at[- ]risk|because (?:she|he|they)|seems? to (?:be|have)|probably|must be|clearly|obviously)\b/i;

export const specialistRegistry: Record<DomainName, SpecialistPack> = {
  academic: {
    node: "AcademicSpecialist",
    codes: [
      "faculty-check-in",
      "student-study-plan",
      "lms-catch-up",
      "internship-review",
      "placement-review",
    ],
    instruction:
      "Explain academic support options without diagnosing or predicting failure.",
    systemPrompt:
      "You are the academic specialist. Work from marks, course-level results and LMS follow-up: name the weakest course or component, propose remediation inside the catalogue (study plan, catch-up on overdue activities), and add internship or placement review only when those signals are present.",
    evidenceView: "full",
    history: true,
  },
  attendance: {
    node: "AttendanceSpecialist",
    codes: ["faculty-check-in", "attendance-review", "lms-catch-up"],
    instruction:
      "Focus on attendance barriers and feasible mentor-led catch-up.",
    systemPrompt:
      "You are the attendance specialist. Look for the pattern by course (which course is lowest, how far below the minimum), keep the outreach conversation early and practical, and pair the attendance review with catch-up on missed learning activities when LMS signals are present.",
    evidenceView: "full",
    history: true,
  },
  "wellbeing-referral": {
    node: "WellbeingReferralSpecialist",
    codes: ["faculty-check-in", "wellbeing-referral"],
    instruction:
      "Never infer a mental-health condition. Only offer an optional mentor-led referral.",
    systemPrompt:
      "You are the wellbeing-referral specialist. You may only propose a mentor check-in and an optional counsellor referral. Describe only the indicators you were given, in neutral terms. Do not label the student, guess at causes or feelings, or mention health, family or personal circumstances; the mentor decides whether a referral is appropriate.",
    evidenceView: "triggering",
    history: false,
    language: WELLBEING_LANGUAGE,
  },
};

const ATTENDANCE_FAMILY = new Set(["ATTENDANCE_LOW"]);
/**
 * Coordinator routing by signals. A wellbeing referral is never inferred from
 * academic data; it runs only when the mentor's plan asks for it. Otherwise the
 * family carrying more policy points wins; a tie keeps the plan's focus.
 */
export function routeSpecialist(
  signals: Array<{ code: string; points: number }>,
  planDomain: DomainName,
): DomainName {
  if (planDomain === "wellbeing-referral") return "wellbeing-referral";
  let attendance = 0,
    academic = 0;
  for (const s of signals)
    if (ATTENDANCE_FAMILY.has(s.code)) attendance += s.points;
    else academic += s.points;
  if (attendance === academic) return planDomain;
  return attendance > academic ? "attendance" : "academic";
}
