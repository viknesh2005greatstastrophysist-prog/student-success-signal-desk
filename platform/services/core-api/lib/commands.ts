import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";
import { assertCommandId, findDuplicateCommand, getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireDepartmentScope } from "./security";

export const publishAndAssignInput = z.object({
  facultyPersonId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export async function publishAndAssignOffering(
  actor: ActorContext,
  offeringId: string,
  commandId: string,
  input: z.infer<typeof publishAndAssignInput>,
) {
  assertCommandId(commandId);

  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) {
      const priorOffering = duplicate.payload.offering as { id?: string } | undefined;
      if (priorOffering?.id !== offeringId || duplicate.payload.facultyPersonId !== input.facultyPersonId) {
        throw new ConflictError("IDEMPOTENCY_KEY_MISMATCH", "This idempotency key was already used for a different publish command");
      }
      return {
        offering: duplicate.payload.offering,
        duplicate: true,
        receipt: duplicate.receipt,
      };
    }

    const offering = await client.query<{
      id: string;
      status: string;
      revision: number;
      code: string;
      title: string;
      department_id: string;
    }>(
      `SELECT o.id, o.status, o.revision, c.code, c.title, c.department_id
       FROM course_offerings o JOIN courses c ON c.id = o.course_id
       WHERE o.generation_id = $1 AND o.id = $2 FOR UPDATE OF o`,
      [generationId, offeringId],
    );
    if (!offering.rowCount) throw new NotFoundError("Offering not found");
    const row = offering.rows[0]!;
    requireDepartmentScope(actor, row.department_id);
    if (row.status !== "draft") throw new ConflictError("ALREADY_PUBLISHED", "This offering is already published");
    if (row.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "The offering changed after this page loaded");

    const faculty = await client.query<{ display_name: string }>(
      `SELECT p.display_name FROM people p
       JOIN role_assignments r ON r.person_id = p.id AND r.generation_id = p.generation_id
       WHERE p.generation_id = $1 AND p.id = $2 AND r.role = 'faculty' AND r.active AND r.department_id = $3`,
      [generationId, input.facultyPersonId, row.department_id],
    );
    if (!faculty.rowCount) throw new ConflictError("FACULTY_SCOPE_MISMATCH", "Select an active faculty member from this department");

    const updated = await client.query<{ revision: number }>(
      "UPDATE course_offerings SET status = 'published', published_at = now(), revision = revision + 1 WHERE id = $1 RETURNING revision",
      [offeringId],
    );
    await client.query(
      `INSERT INTO faculty_assignments (id, generation_id, faculty_person_id, course_offering_id, assigned_by_person_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), generationId, input.facultyPersonId, offeringId, actor.personId],
    );
    const eventPayload = {
      departmentId: row.department_id,
      facultyPersonId: input.facultyPersonId,
      facultyName: faculty.rows[0]!.display_name,
      offering: { id: row.id, code: row.code, title: row.title, status: "published", revision: updated.rows[0]!.revision },
    };
    const receipt = await writeCommandLedger(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "course_offering",
      aggregateId: offeringId,
      eventType: "offering.published",
      action: "publish_and_assign",
      topic: "academic.offering.published",
      payload: eventPayload,
      metadata: { expectedRevision: input.expectedRevision },
    });

    return {
      offering: eventPayload.offering,
      duplicate: false,
      receipt,
    };
  });
}
