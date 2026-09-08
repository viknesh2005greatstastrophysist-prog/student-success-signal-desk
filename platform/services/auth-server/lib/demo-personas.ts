import { demoStudents, demoMentors, demoParents, portalOidcClients, type PortalId } from "@aura/contracts";

export type DemoPersona = {
  portal: PortalId;
  clientId: string;
  name: string;
  label: string;
  email: string;
};

export const demoPersonas: readonly DemoPersona[] = [
  ...demoStudents.map(p => ({ ...p, portal: "student" as const, clientId: portalOidcClients.student, label: "CSE student · semester 7" })),
  ...demoParents.map(p => ({ ...p, portal: "parent" as const, clientId: portalOidcClients.parent, label: "Parent · linked student records" })),
  ...demoMentors.map(p => ({ ...p, portal: "faculty" as const, clientId: portalOidcClients.faculty, label: "CSE mentor · classes and mentees" })),
  { portal: "hod", clientId: portalOidcClients.hod, name: "Dr Sahana Krishnan", label: "Head · Computer Science", email: "hod.cse@aura.invalid" },
  { portal: "governance", clientId: portalOidcClients.governance, name: "AURA Governance Operator", label: "Evidence and replay authority", email: "governance@aura.invalid" },
  { portal: "governance", clientId: portalOidcClients.governance, name: "Dr Sahana Krishnan", label: "HoD · review controls", email: "hod.cse@aura.invalid" },
  ...demoStudents.map(p => ({ ...p, portal: "lms" as const, clientId: portalOidcClients.lms, label: "Student" })),
  ...demoMentors.map(p => ({ ...p, portal: "lms" as const, clientId: portalOidcClients.lms, label: "Faculty" })),
  { portal: "lms", clientId: portalOidcClients.lms, name: "Dr Sahana Krishnan", label: "HoD · department courses", email: "hod.cse@aura.invalid" },
] as const;

export function demoPersonaForClient(clientId: string | undefined, account?: string): DemoPersona | undefined {
  return demoPersonas.find((persona) => persona.clientId === clientId && (!account || persona.email === account));
}
