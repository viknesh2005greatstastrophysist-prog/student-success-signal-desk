import { portalDefinitions } from "@aura/contracts";
import { PortalHome } from "@aura/portal-kit";
export default function Page() { return <PortalHome portal={portalDefinitions.parent} release={process.env.RELEASE_SHA ?? process.env.COMMIT_REF ?? process.env.VERCEL_GIT_COMMIT_SHA} />; }
