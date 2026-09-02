import { z } from "zod";

import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { withdrawRegistration } from "@/lib/registration-commands";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const commandId = request.headers.get("idempotency-key") ?? "";
    return noStore(await withdrawRegistration(actor, id, commandId));
  } catch (error) { return apiFailure(error); }
}
