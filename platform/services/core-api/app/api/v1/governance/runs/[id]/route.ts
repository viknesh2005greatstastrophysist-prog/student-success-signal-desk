import { z } from "zod";

import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { loadGovernanceRun } from "@/lib/support-commands";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    return noStore(await loadGovernanceRun(actor, id));
  } catch (error) { return apiFailure(error); }
}
