import { portalCollegeSources } from "@aura/portal-kit/server";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return portalCollegeSources(request, "student"); }
