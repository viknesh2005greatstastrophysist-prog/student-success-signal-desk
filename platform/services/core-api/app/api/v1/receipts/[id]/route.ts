import { z } from "zod";

import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { loadPaymentReceipt } from "@/lib/payment-commands";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    return noStore(await loadPaymentReceipt(actor, id));
  } catch (error) { return apiFailure(error); }
}
