import { authenticateRequest } from "@/lib/authentication";
import { apiFailure,noStore,NotFoundError } from "@/lib/http";
import { lmsOverview,lmsCourseDetail,readLmsAttachment } from "@/lib/lms-queries";
import { lmsCommand } from "@/lib/lms-commands";
export const dynamic="force-dynamic";
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){
  try{
    const actor=await authenticateRequest(request);const {path}=await context.params;
    if(path.join("/")==="overview")return noStore(await lmsOverview(actor));
    if(path.length===2 && path[0]==="courses")return noStore(await lmsCourseDetail(actor,path[1]!));
    if(path.length===3 && path[0]==="files"){
      const file=await readLmsAttachment(actor,path[1]!,path[2]!);
      return new Response(new Uint8Array(Buffer.from(file.data,"base64")),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    throw new NotFoundError("LMS page not found");
  }catch(error){return apiFailure(error);}
}
export async function POST(request:Request,context:Context){
  try{
    if((await context.params).path.join("/")!=="commands")throw new NotFoundError("LMS action not found");
    const actor=await authenticateRequest(request);
    const raw=await request.text();
    if(raw.length>2_900_000)return Response.json({ok:false,error:{code:"FILE_TOO_LARGE",message:"Use a file smaller than 2 MB"}},{status:413});
    return noStore(await lmsCommand(actor,request.headers.get("idempotency-key") ?? "",JSON.parse(raw)));
  }catch(error){return apiFailure(error);}
}
