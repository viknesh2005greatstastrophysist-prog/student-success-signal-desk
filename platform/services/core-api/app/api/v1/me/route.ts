import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    return noStore({ role: actor.role, displayName: actor.displayName, email: actor.email });
  } catch (error) { return apiFailure(error); }
}
