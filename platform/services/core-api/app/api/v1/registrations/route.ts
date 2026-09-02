import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { registerForOffering, registerInput } from "@/lib/registration-commands";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const commandId = request.headers.get("idempotency-key") ?? "";
    return noStore(await registerForOffering(actor, commandId, registerInput.parse(await request.json())));
  } catch (error) { return apiFailure(error); }
}
