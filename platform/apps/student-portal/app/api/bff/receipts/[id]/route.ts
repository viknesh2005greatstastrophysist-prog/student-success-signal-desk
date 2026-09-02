import { portalDownloadReceipt } from "@aura/portal-kit/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return portalDownloadReceipt(request, "student", id);
}
