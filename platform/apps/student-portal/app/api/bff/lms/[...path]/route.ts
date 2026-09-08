import { portalResource } from "@aura/portal-kit/server";
export const dynamic="force-dynamic";
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){ return portalResource(request,"student","lms",(await context.params).path); }
export async function POST(request:Request,context:Context){ return portalResource(request,"student","lms",(await context.params).path); }
