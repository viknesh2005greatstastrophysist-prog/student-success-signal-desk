import { portalChapter11 } from "@aura/portal-kit/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) { return portalChapter11(request, "hod", (await context.params).path); }
