import { isCollegeProject } from "@aura/contracts";
import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { loadAuthenticatedCollegeSources } from "@/lib/college-vault";
import { loadProjectSources } from "@/lib/project-sources";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const actor=await authenticateRequest(request); return noStore(await (isCollegeProject()?loadProjectSources(actor):loadAuthenticatedCollegeSources(actor))); }
  catch (error) { return apiFailure(error); }
}
