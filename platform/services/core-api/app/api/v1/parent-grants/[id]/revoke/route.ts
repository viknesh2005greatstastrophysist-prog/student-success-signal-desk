import { z } from "zod";

import { authenticateRequest } from "@/lib/authentication";
import { revokeGrantInput, revokeParentGrant } from "@/lib/grant-commands";
import { apiFailure, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const result = await revokeParentGrant(actor, id, request.headers.get("idempotency-key") ?? "", revokeGrantInput.parse(await request.json()));
    return noStore(result);
  } catch (error) { return apiFailure(error); }
}
