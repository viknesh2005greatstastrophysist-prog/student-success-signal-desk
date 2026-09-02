import { z } from "zod";

export const portalIdSchema = z.enum(["student", "parent", "faculty", "hod", "governance"]);
export type PortalId = z.infer<typeof portalIdSchema>;

export const actorRoleSchema = z.enum(["student", "parent", "faculty", "hod", "governance"]);
export type ActorRole = z.infer<typeof actorRoleSchema>;

export const actorContextSchema = z.object({
  subject: z.string().min(1),
  role: actorRoleSchema,
  personId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});
export type ActorContext = z.infer<typeof actorContextSchema>;

export const coreApiAudience = "urn:aura:core-api" as const;

export const portalOidcClients: Record<PortalId, string> = {
  student: "lmRWsqnSAcDGRngoatHbmwjkejdiXBLl",
  parent: "ZtyvYAeWCEUxfDNSSnkUjsNtJybzQHHg",
  faculty: "uSidVDdjNoQCabBMghhPkIXdRBFvPRDw",
  hod: "kqiOIOfbMBtlcIqJxIjHmIHinbBQsnCX",
  governance: "jnDmKEJpxPXzqcwskyxaPJReUkAEWXLE",
};

export const causalReceiptSchema = z.object({
  commandId: z.string().uuid(),
  eventId: z.string().uuid(),
  auditId: z.string().uuid(),
  institutionRevision: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
});
export type CausalReceipt = z.infer<typeof causalReceiptSchema>;

export const seedManifestSchema = z.object({
  seedVersion: z.literal("AURA-SYNTHETIC-SEED-V1"),
  generationId: z.string().uuid(),
  institutionCode: z.literal("AURA-DEMO"),
  termCode: z.literal("2026-ODD"),
  counts: z.object({
    departments: z.literal(2),
    students: z.literal(12),
    parents: z.literal(9),
    faculty: z.literal(4),
    hods: z.literal(2),
    courses: z.literal(6),
    offerings: z.literal(6),
  }),
  demoSubjects: z.object({
    student: z.literal("aura-demo-student"),
    parent: z.literal("aura-demo-parent"),
    faculty: z.literal("aura-demo-faculty"),
    hod: z.literal("aura-demo-hod"),
    governance: z.literal("aura-demo-governance"),
  }),
});
export type SeedManifest = z.infer<typeof seedManifestSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().uuid().optional(),
});

export const apiEnvelope = <T extends z.ZodType>(data: T) =>
  z.union([z.object({ ok: z.literal(true), data }), z.object({ ok: z.literal(false), error: apiErrorSchema })]);

export type ActionContract = {
  id: string;
  portal: PortalId | "identity";
  type: "navigate" | "query" | "command" | "form";
  destination: string;
};

export const actionManifest: readonly ActionContract[] = [
  { id: "identity-open-discovery", portal: "identity", type: "navigate", destination: "/api/auth/.well-known/openid-configuration" },
  { id: "identity-access-pin", portal: "identity", type: "form", destination: "/api/demo/sign-in" },
  { id: "identity-enter-portal", portal: "identity", type: "form", destination: "/api/demo/sign-in" },
  { id: "identity-consent-allow", portal: "identity", type: "command", destination: "/api/auth/oauth2/consent" },
  { id: "identity-consent-deny", portal: "identity", type: "command", destination: "/api/auth/oauth2/consent" },
  ...(["student", "parent", "faculty", "hod", "governance"] as const).flatMap((portal) => [
    { id: `${portal}-sign-in`, portal, type: "navigate" as const, destination: "/api/session/login" },
    { id: `${portal}-refresh`, portal, type: "query" as const, destination: "/api/bff/dashboard" },
    { id: `${portal}-sign-out`, portal, type: "command" as const, destination: "/api/session/logout" },
    { id: `${portal}-retry`, portal, type: "query" as const, destination: "/api/bff/dashboard" },
  ]),
  { id: "hod-select-faculty", portal: "hod", type: "form", destination: "publish-and-assign form" },
  { id: "hod-publish-and-assign", portal: "hod", type: "command", destination: "/api/bff/offerings/:id/publish-and-assign" },
  { id: "student-open-today", portal: "student", type: "navigate", destination: "Today surface" },
  { id: "student-open-registration", portal: "student", type: "navigate", destination: "Registration surface" },
  { id: "student-open-academics", portal: "student", type: "navigate", destination: "Published academics surface" },
  { id: "student-open-fees", portal: "student", type: "navigate", destination: "Read-only fee statement" },
  { id: "student-open-account", portal: "student", type: "navigate", destination: "Parent field grants" },
  { id: "student-start-grant-revocation", portal: "student", type: "form", destination: "Grant revocation confirmation" },
  { id: "student-cancel-grant-revocation", portal: "student", type: "form", destination: "Parent field grants" },
  { id: "student-confirm-grant-revocation", portal: "student", type: "command", destination: "/api/bff/parent-grants/:id/revoke" },
  { id: "student-start-registration", portal: "student", type: "form", destination: "Registration confirmation" },
  { id: "student-cancel-registration", portal: "student", type: "form", destination: "Registration sheet" },
  { id: "student-confirm-registration", portal: "student", type: "command", destination: "/api/bff/registrations" },
  { id: "student-withdraw-registration", portal: "student", type: "command", destination: "/api/bff/registrations/:id/withdraw" },
  { id: "faculty-open-today", portal: "faculty", type: "navigate", destination: "Today surface" },
  { id: "faculty-open-classrooms", portal: "faculty", type: "navigate", destination: "Classroom roster" },
  { id: "faculty-open-gradebook", portal: "faculty", type: "navigate", destination: "Gradebook" },
  { id: "faculty-set-attendance", portal: "faculty", type: "form", destination: "Attendance sheet" },
  { id: "faculty-submit-attendance", portal: "faculty", type: "command", destination: "/api/bff/attendance-sessions/:id/submit" },
  { id: "faculty-enter-mark", portal: "faculty", type: "form", destination: "Gradebook" },
  { id: "faculty-publish-marks", portal: "faculty", type: "command", destination: "/api/bff/assessments/:id/marks" },
  { id: "parent-open-overview", portal: "parent", type: "navigate", destination: "Parent overview" },
  { id: "parent-open-children", portal: "parent", type: "navigate", destination: "Granted child academics" },
  { id: "parent-open-fees", portal: "parent", type: "navigate", destination: "Sandbox fee checkout" },
  { id: "parent-open-access", portal: "parent", type: "navigate", destination: "Field grant ledger" },
  { id: "parent-select-payment-scenario", portal: "parent", type: "form", destination: "Sandbox checkout" },
  { id: "parent-start-payment", portal: "parent", type: "form", destination: "Payment confirmation" },
  { id: "parent-cancel-payment", portal: "parent", type: "form", destination: "Sandbox checkout" },
  { id: "parent-confirm-payment", portal: "parent", type: "command", destination: "/api/bff/fees/invoices/:id/payment-attempts" },
  { id: "parent-download-receipt", portal: "parent", type: "query", destination: "/api/bff/receipts/:id" },
  { id: "hod-open-department", portal: "hod", type: "navigate", destination: "Department surface" },
  { id: "hod-open-offerings", portal: "hod", type: "navigate", destination: "Offering command" },
];

export type PortalDefinition = {
  id: PortalId;
  name: string;
  actor: string;
  purpose: string;
  accent: string;
  capabilities: readonly string[];
  prohibited: readonly string[];
};

export const portalDefinitions: Record<PortalId, PortalDefinition> = {
  student: {
    id: "student",
    name: "Student Portal",
    actor: "Synthetic student",
    purpose: "Manage registration and understand personal academic records and approved support.",
    accent: "#9f1239",
    capabilities: ["Course registration", "Timetable", "Attendance and marks", "Fee status", "Approved support"],
    prohibited: ["Other student records", "Internal agent reasoning"],
  },
  parent: {
    id: "parent",
    name: "Parent Portal",
    actor: "Linked parent or guardian",
    purpose: "View only the fields permitted for an actively linked synthetic student.",
    accent: "#9a3412",
    capabilities: ["Linked student overview", "Attendance and marks", "Fee status", "Approved support"],
    prohibited: ["Self-created links", "Revoked fields", "Internal faculty notes"],
  },
  faculty: {
    id: "faculty",
    name: "Faculty Portal",
    actor: "Assigned faculty member",
    purpose: "Operate assigned classrooms and make accountable support decisions.",
    accent: "#1d4ed8",
    capabilities: ["Assigned classrooms", "Attendance entry", "Marks and corrections", "Case review", "Approve or reject"],
    prohibited: ["Unassigned sections", "Stale-artifact approval"],
  },
  hod: {
    id: "hod",
    name: "HOD Portal",
    actor: "Department head",
    purpose: "Operate course and departmental oversight within one authorised department.",
    accent: "#6d28d9",
    capabilities: ["Course publication", "Faculty assignments", "Department students", "Workload", "Case disposition"],
    prohibited: ["Other departments", "Authentication secrets"],
  },
  governance: {
    id: "governance",
    name: "AI Governance Console",
    actor: "AURA governance operator",
    purpose: "Inspect agent evidence, failures, lineage, fallback, audit and replay.",
    accent: "#047857",
    capabilities: ["Synthetic scan", "Evidence lineage", "Validation and repair", "Replay", "Evidence export"],
    prohibited: ["Academic record mutation", "Faculty approval"],
  },
};
