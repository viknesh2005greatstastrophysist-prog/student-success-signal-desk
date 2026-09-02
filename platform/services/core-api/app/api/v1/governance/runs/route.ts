import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { processAcademicEvent, processAcademicEventInput } from "@/lib/support-commands";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const result = await processAcademicEvent(actor, request.headers.get("idempotency-key") ?? "", processAcademicEventInput.parse(await request.json()));
    return noStore(result, result.duplicate ? 200 : 201);
  } catch (error) { return apiFailure(error); }
}
