import { portalResetSimulation } from "@aura/portal-kit/server";

export const dynamic = "force-dynamic";
export function POST(request: Request) { return portalResetSimulation(request, "governance"); }
