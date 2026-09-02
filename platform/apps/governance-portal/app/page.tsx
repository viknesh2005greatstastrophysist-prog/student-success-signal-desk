import { portalDefinitions } from "@aura/contracts";
import { PortalHome } from "@aura/portal-kit";
export default function Page() { return <PortalHome portal={portalDefinitions.governance} release={process.env.VERCEL_GIT_COMMIT_SHA} />; }
