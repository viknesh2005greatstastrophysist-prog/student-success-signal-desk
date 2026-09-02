import { randomUUID } from "node:crypto";
import { causalReceiptSchema, type ActorContext } from "@aura/contracts";
import { z } from "zod";
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
  if (!z.string().uuid().safeParse(commandId).success) throw new ConflictError("INVALID_IDEMPOTENCY_KEY", "A UUID idempotency key is required");

  return withCoreTransaction(async (client) => {
    const current = await client.query<{ generation_id: string }>(
      "SELECT current_generation_id AS generation_id FROM institution_revisions WHERE singleton = true",
    );
    const generationId = current.rows[0]!.generation_id;
    const duplicate = await client.query(
      `SELECT cr.command_id, cr.event_id, cr.audit_id, cr.institution_revision, cr.occurred_at,
              de.payload
       FROM command_receipts cr JOIN domain_events de ON de.id = cr.event_id
       WHERE cr.generation_id = $1 AND cr.command_id = $2`,
      [generationId, commandId],
    );
    if (duplicate.rowCount) {
      const row = duplicate.rows[0];
      return {
        offering: row.payload.offering,
        duplicate: true,
        receipt: causalReceiptSchema.parse({
          commandId: row.command_id,
          eventId: row.event_id,
          auditId: row.audit_id,
          institutionRevision: Number(row.institution_revision),
          occurredAt: new Date(row.occurred_at).toISOString(),
        }),
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
    const revision = await client.query<{ revision: string }>(
      "UPDATE institution_revisions SET revision = revision + 1, updated_at = now() WHERE singleton = true RETURNING revision::text",
    );

    const eventId = randomUUID();
    const auditId = randomUUID();
    const receiptId = randomUUID();
    const occurredAt = new Date().toISOString();
    const eventPayload = {
      departmentId: row.department_id,
      facultyPersonId: input.facultyPersonId,
      facultyName: faculty.rows[0]!.display_name,
      offering: { id: row.id, code: row.code, title: row.title, status: "published", revision: updated.rows[0]!.revision },
    };
    await client.query(
      `INSERT INTO domain_events (id, generation_id, aggregate_type, aggregate_id, event_type, command_id, actor_person_id, institution_revision, payload, occurred_at)
       VALUES ($1, $2, 'course_offering', $3, 'offering.published', $4, $5, $6, $7::jsonb, $8)`,
      [eventId, generationId, offeringId, commandId, actor.personId, revision.rows[0]!.revision, JSON.stringify(eventPayload), occurredAt],
    );
    await client.query(
      "INSERT INTO outbox_items (id, generation_id, domain_event_id, topic, payload) VALUES ($1, $2, $3, 'academic.offering.published', $4::jsonb)",
      [randomUUID(), generationId, eventId, JSON.stringify(eventPayload)],
    );
    await client.query(
      `INSERT INTO audit_events (id, generation_id, command_id, event_id, actor_person_id, action, resource_type, resource_id, outcome, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'publish_and_assign', 'course_offering', $6, 'allowed', $7::jsonb, $8)`,
      [auditId, generationId, commandId, eventId, actor.personId, offeringId, JSON.stringify({ expectedRevision: input.expectedRevision }), occurredAt],
    );
    await client.query(
      `INSERT INTO command_receipts (id, generation_id, command_id, event_id, audit_id, institution_revision, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [receiptId, generationId, commandId, eventId, auditId, revision.rows[0]!.revision, occurredAt],
    );

    return {
      offering: eventPayload.offering,
      duplicate: false,
      receipt: causalReceiptSchema.parse({
        commandId,
        eventId,
        auditId,
        institutionRevision: Number(revision.rows[0]!.revision),
        occurredAt,
      }),
    };
  });
}
