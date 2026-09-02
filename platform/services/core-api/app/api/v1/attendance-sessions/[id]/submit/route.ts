import { z } from "zod";

import { submitAttendance, submitAttendanceInput } from "@/lib/academic-commands";
import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await context.params;
    z.string().uuid().parse(id);
    return noStore(await submitAttendance(actor, id, request.headers.get("idempotency-key") ?? "", submitAttendanceInput.parse(await request.json())));
  } catch (error) { return apiFailure(error); }
}
