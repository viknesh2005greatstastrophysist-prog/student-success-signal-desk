import { portalPublishAndAssign } from "@aura/portal-kit/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return portalPublishAndAssign(request, "hod", (await context.params).id);
}
