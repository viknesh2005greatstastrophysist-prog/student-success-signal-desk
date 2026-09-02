import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { loadPortalSnapshot } from "@/lib/projections";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const childId = new URL(request.url).searchParams.get("childId") ?? undefined;
    if (childId) z.string().uuid().parse(childId);
    return noStore(await loadPortalSnapshot(await authenticateRequest(request), childId));
  }
  catch (error) { return apiFailure(error); }
}
