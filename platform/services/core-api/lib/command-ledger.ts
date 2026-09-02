import { randomUUID } from "node:crypto";
import { causalReceiptSchema } from "@aura/contracts";
import type { PoolClient } from "pg";
import { z } from "zod";

import { ConflictError } from "./http";

export function assertCommandId(commandId: string) {
  if (!z.string().uuid().safeParse(commandId).success) {
    throw new ConflictError("INVALID_IDEMPOTENCY_KEY", "A UUID idempotency key is required");
  }
}

export async function getCurrentGeneration(client: PoolClient) {
  const result = await client.query<{ generation_id: string }>(
    "SELECT current_generation_id AS generation_id FROM institution_revisions WHERE singleton = true",
  );
  return result.rows[0]!.generation_id;
}

export async function findDuplicateCommand(client: PoolClient, generationId: string, commandId: string, actorPersonId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [commandId]);
  const result = await client.query<{
    command_id: string;
    event_id: string;
    audit_id: string;
    institution_revision: string;
    occurred_at: Date;
    payload: Record<string, unknown>;
    actor_person_id: string;
  }>(
    `SELECT cr.command_id, cr.event_id, cr.audit_id, cr.institution_revision::text, cr.occurred_at, de.payload,
            audit.actor_person_id
     FROM command_receipts cr JOIN domain_events de ON de.id = cr.event_id
     JOIN audit_events audit ON audit.id = cr.audit_id
     WHERE cr.generation_id = $1 AND cr.command_id = $2`,
    [generationId, commandId],
  );
  if (!result.rowCount) return undefined;
  const row = result.rows[0]!;
  if (row.actor_person_id !== actorPersonId) {
    throw new ConflictError("IDEMPOTENCY_KEY_REUSED", "This idempotency key belongs to another actor");
  }
  return {
    payload: row.payload,
    receipt: causalReceiptSchema.parse({
      commandId: row.command_id,
      eventId: row.event_id,
      auditId: row.audit_id,
      institutionRevision: Number(row.institution_revision),
      occurredAt: row.occurred_at.toISOString(),
    }),
  };
}

export async function writeCommandLedger(client: PoolClient, input: {
  generationId: string;
  commandId: string;
  actorPersonId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  action: string;
  topic: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const revision = await client.query<{ revision: string }>(
    "UPDATE institution_revisions SET revision = revision + 1, updated_at = now() WHERE singleton = true RETURNING revision::text",
  );
  const eventId = randomUUID();
  const auditId = randomUUID();
  const occurredAt = new Date().toISOString();
  await client.query(
    `INSERT INTO domain_events (id, generation_id, aggregate_type, aggregate_id, event_type, command_id, actor_person_id, institution_revision, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [eventId, input.generationId, input.aggregateType, input.aggregateId, input.eventType, input.commandId, input.actorPersonId, revision.rows[0]!.revision, JSON.stringify(input.payload), occurredAt],
  );
  await client.query(
    "INSERT INTO outbox_items (id, generation_id, domain_event_id, topic, payload) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [randomUUID(), input.generationId, eventId, input.topic, JSON.stringify(input.payload)],
  );
  await client.query(
    `INSERT INTO audit_events (id, generation_id, command_id, event_id, actor_person_id, action, resource_type, resource_id, outcome, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'allowed', $9::jsonb, $10)`,
    [auditId, input.generationId, input.commandId, eventId, input.actorPersonId, input.action, input.aggregateType, input.aggregateId, JSON.stringify(input.metadata ?? {}), occurredAt],
  );
  await client.query(
    `INSERT INTO command_receipts (id, generation_id, command_id, event_id, audit_id, institution_revision, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), input.generationId, input.commandId, eventId, auditId, revision.rows[0]!.revision, occurredAt],
  );
  return causalReceiptSchema.parse({
    commandId: input.commandId,
    eventId,
    auditId,
    institutionRevision: Number(revision.rows[0]!.revision),
    occurredAt,
  });
}
