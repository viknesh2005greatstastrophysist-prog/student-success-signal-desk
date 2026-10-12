import { ExperiencePortal } from "@aura/portal-kit/experience";
export const dynamic = "force-dynamic";
const recordMode = process.env.AURA_PORTAL_MODE === "project" ? "project" : process.env.AURA_PORTAL_MODE === "institutional" ? "college" : "demo";
export default function Page() {
  return <ExperiencePortal portal="parent" recordMode={recordMode} />;
}
