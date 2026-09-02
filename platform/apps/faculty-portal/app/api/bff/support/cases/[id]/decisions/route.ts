import { portalDecideSupportCase } from "@aura/portal-kit/server";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return portalDecideSupportCase(request, "faculty", id);
}
