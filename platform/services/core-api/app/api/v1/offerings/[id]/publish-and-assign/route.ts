import { z } from "zod";
import { authenticateRequest } from "@/lib/authentication";
import { publishAndAssignInput, publishAndAssignOffering } from "@/lib/commands";
import { apiFailure, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const commandId = request.headers.get("idempotency-key") ?? "";
    const input = publishAndAssignInput.parse(await request.json());
    return noStore(await publishAndAssignOffering(actor, id, commandId, input));
  } catch (error) { return apiFailure(error); }
}
