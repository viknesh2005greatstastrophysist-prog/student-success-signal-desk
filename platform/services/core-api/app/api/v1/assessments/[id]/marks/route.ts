import { z } from "zod";

import { publishMarks, publishMarksInput } from "@/lib/academic-commands";
import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    return noStore(await publishMarks(actor, id, request.headers.get("idempotency-key") ?? "", publishMarksInput.parse(await request.json())));
  } catch (error) { return apiFailure(error); }
}
