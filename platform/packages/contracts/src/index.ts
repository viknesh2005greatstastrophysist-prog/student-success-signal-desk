export type PortalId = "student" | "parent" | "faculty" | "hod" | "governance";

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
