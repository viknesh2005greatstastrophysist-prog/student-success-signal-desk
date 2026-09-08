import { authenticateRequest } from "@/lib/authentication";
import { apiFailure,noStore,NotFoundError } from "@/lib/http";
import { experienceOverview,experienceStudent,experienceClassroom } from "@/lib/experience-queries";
import { experienceCommand } from "@/lib/experience-commands";
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){
  try{const actor=await authenticateRequest(request);const {path}=await context.params;
    if(path.join('/')==='overview')return noStore(await experienceOverview(actor));
    if(path.length===2 && path[0]==='students')return noStore(await experienceStudent(actor,path[1]!));
    if(path.length===2 && path[0]==='classrooms')return noStore(await experienceClassroom(actor,path[1]!));
    throw new NotFoundError('Page not found');
  }catch(error){return apiFailure(error);}
}
export async function POST(request:Request,context:Context){
  try{if((await context.params).path.join('/')!=='commands')throw new NotFoundError('Action not found');const actor=await authenticateRequest(request);return noStore(await experienceCommand(actor,request.headers.get('idempotency-key')??'',await request.json()));}catch(error){return apiFailure(error);}
}
