import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { loadPortalSnapshot } from "@/lib/projections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { return noStore(await loadPortalSnapshot(await authenticateRequest(request))); }
  catch (error) { return apiFailure(error); }
}
