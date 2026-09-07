import { z } from "zod";
import { authenticateRequest } from "@/lib/authentication";
import { apiFailure, noStore, NotFoundError } from "@/lib/http";
import { approvePolicy, executePlan, exportPlan, lockPlan, overview, readSource, savePlan, seedChapterSources } from "@/lib/chapter11/service";
import { DataBlocked, sourceNames } from "@/lib/chapter11/engine";
import { editDraft, recordOutcome, reviewQueue } from "@/lib/chapter11/review";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await authenticateRequest(request);
    const { path } = await context.params;
    if (path.join("/") === "overview") return noStore(await overview(actor));
    if (path.join("/") === "review") return noStore(await reviewQueue(actor));
    if (path.length === 3 && path[0] === "plans" && path[2] === "export") return noStore(await exportPlan(actor, path[1]!));
    if (path.length === 3 && path[0] === "sources") return noStore(await readSource(actor, path[1]!, z.enum(sourceNames).parse(path[2])));
    throw new NotFoundError("Chapter 11 endpoint not found");
  } catch (error) {
    if (error instanceof DataBlocked) return Response.json({ ok: false, error: { code: "DATA_BLOCKED", message: error.message } }, { status: 409 });
    return apiFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await authenticateRequest(request);
    const { path } = await context.params;
    const body = await request.json();
    if (path.length === 3 && path[0] === "cases" && path[2] === "edit") return noStore(await editDraft(actor, path[1]!, request.headers.get("idempotency-key") ?? "", body));
    if (path.length === 3 && path[0] === "interventions" && path[2] === "outcome") return noStore(await recordOutcome(actor, path[1]!, request.headers.get("idempotency-key") ?? "", body));
    if (path.join("/") === "policies") return noStore(await approvePolicy(actor, body, z.string().uuid().parse(request.headers.get("idempotency-key"))), 201);
    if (path.join("/") === "sources/seed") return noStore(await seedChapterSources(actor));
    if (path.join("/") === "plans") return noStore(await savePlan(actor, body, undefined, undefined, z.string().uuid().parse(request.headers.get("idempotency-key"))), 201);
    if (path.length === 3 && path[0] === "plans") {
      if (path[2] === "revise") {
        const input = z.object({ expectedRevision: z.number().int().nonnegative(), input: z.unknown() }).strict().parse(body);
        return noStore(await savePlan(actor, input.input, path[1]!, input.expectedRevision));
      }
      if (path[2] === "lock") return noStore(await lockPlan(actor, path[1]!, z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(body).expectedRevision));
      if (path[2] === "execute") { z.object({}).strict().parse(body); return noStore(await executePlan(actor, path[1]!)); }
    }
    throw new NotFoundError("Chapter 11 command not found");
  } catch (error) { return apiFailure(error); }
}
