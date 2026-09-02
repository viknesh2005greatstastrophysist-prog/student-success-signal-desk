import { portalDashboard } from "@aura/portal-kit/server";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return portalDashboard(request, "student"); }
