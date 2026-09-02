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
] as const;

export function demoPersonaForClient(clientId: string | undefined): DemoPersona | undefined {
  return demoPersonas.find((persona) => persona.clientId === clientId);
}
