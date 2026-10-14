/** Approved action catalogue and review domains (shared, dependency-free). */
export const domainNames = [
  "academic",
  "attendance",
  "wellbeing-referral",
] as const;
export type DomainName = (typeof domainNames)[number];
export const actions = {
  "faculty-check-in":
    "Schedule a 20-minute academic check-in with the assigned mentor",
  "student-study-plan": "Agree a weekly study plan with the assigned mentor",
  "attendance-review":
    "Review attendance barriers and agree an attendance plan with the mentor",
  "lms-catch-up": "Agree a catch-up schedule for overdue learning activities",
  "internship-review":
    "Review missed internship milestones with the assigned mentor",
  "placement-review":
    "Review placement preparation activities with the assigned mentor",
  "wellbeing-referral":
    "Ask the mentor whether an optional support-service referral is appropriate",
} as const;
export type ActionCode = keyof typeof actions;
export const actionCodes = Object.keys(actions) as [ActionCode, ...ActionCode[]];
