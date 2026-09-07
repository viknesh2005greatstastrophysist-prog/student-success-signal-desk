import { portalChapter11 } from "@aura/portal-kit/server";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) { return portalChapter11(request, "faculty", (await context.params).path); }
export async function POST(request: Request, context: Context) { return portalChapter11(request, "faculty", (await context.params).path); }
