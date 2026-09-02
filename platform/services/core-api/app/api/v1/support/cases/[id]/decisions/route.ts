import { z } from "zod";

import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { decideSupportCase, supportDecisionInput } from "@/lib/support-commands";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const result = await decideSupportCase(actor, id, request.headers.get("idempotency-key") ?? "", supportDecisionInput.parse(await request.json()));
    return noStore(result, result.duplicate ? 200 : 201);
  } catch (error) { return apiFailure(error); }
}
