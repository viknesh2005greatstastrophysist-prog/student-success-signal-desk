import { portalOidcClients, type PortalId } from "@aura/contracts";

export type DemoPersona = {
  portal: PortalId;
  clientId: string;
  name: string;
  label: string;
  email: string;
};

export const demoPersonas: readonly DemoPersona[] = [
  { portal: "student", clientId: portalOidcClients.student, name: "Ananya Rao", label: "CSE student · semester 7", email: "student1@aura.invalid" },
  { portal: "parent", clientId: portalOidcClients.parent, name: "Lakshmi Rao", label: "Linked guardian · consent scoped", email: "parent1@aura.invalid" },
  { portal: "faculty", clientId: portalOidcClients.faculty, name: "Dr Mira Sen", label: "CSE faculty · assigned sections", email: "faculty1@aura.invalid" },
  { portal: "hod", clientId: portalOidcClients.hod, name: "Dr Sahana Krishnan", label: "Head · Computer Science", email: "hod.cse@aura.invalid" },
  { portal: "governance", clientId: portalOidcClients.governance, name: "AURA Governance Operator", label: "Evidence and replay authority", email: "governance@aura.invalid" },
  { portal: "governance", clientId: portalOidcClients.governance, name: "Dr Sahana Krishnan", label: "HoD · review controls", email: "hod.cse@aura.invalid" },
  { portal: "lms", clientId: portalOidcClients.lms, name: "Ananya Rao", label: "Student · course work and feedback", email: "student1@aura.invalid" },
  { portal: "lms", clientId: portalOidcClients.lms, name: "Dr Mira Sen", label: "Faculty · lessons and assignments", email: "faculty1@aura.invalid" },
  { portal: "lms", clientId: portalOidcClients.lms, name: "Dr Sahana Krishnan", label: "HoD · department courses", email: "hod.cse@aura.invalid" },
] as const;

export function demoPersonaForClient(clientId: string | undefined, account?: string): DemoPersona | undefined {
  return demoPersonas.find((persona) => persona.clientId === clientId && (!account || persona.email === account));
}
