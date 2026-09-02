import { z } from "zod";
import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore } from "@/lib/http";
import { resetSyntheticSeed } from "@/lib/reset";
import { requireRole } from "@/lib/security";

export const dynamic = "force-dynamic";
const resetInput = z.object({ confirmation: z.literal("AURA-SYNTHETIC-SEED-V1") }).strict();

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    requireRole(actor, "governance");
    const input = resetInput.parse(await request.json());
    const manifest = await resetSyntheticSeed(input.confirmation, actor.subject);
    return noStore({ manifest }, 201);
  } catch (error) { return apiFailure(error); }
}
