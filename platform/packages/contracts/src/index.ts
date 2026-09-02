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
