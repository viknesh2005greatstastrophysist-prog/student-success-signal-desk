import type { ActionCode, DomainName } from "./catalogue";

export type SpecialistPack = { codes: ActionCode[]; instruction: string };
export const specialistRegistry: Record<DomainName, SpecialistPack> = {
  academic: {
    codes: [
      "faculty-check-in",
      "student-study-plan",
      "lms-catch-up",
      "internship-review",
      "placement-review",
    ],
    instruction:
      "Explain academic support options without diagnosing or predicting failure.",
  },
  attendance: {
    codes: ["faculty-check-in", "attendance-review", "lms-catch-up"],
    instruction:
      "Focus on attendance barriers and feasible mentor-led catch-up.",
  },
  "wellbeing-referral": {
    codes: ["faculty-check-in", "wellbeing-referral"],
    instruction:
      "Never infer a mental-health condition. Only offer an optional mentor-led referral.",
  },
};
