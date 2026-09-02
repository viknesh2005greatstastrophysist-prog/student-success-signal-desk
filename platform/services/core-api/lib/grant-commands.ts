import type { ActorContext } from "@aura/contracts";
import { z } from "zod";

import { assertCommandId, findDuplicateCommand, getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole } from "./security";

export const revokeGrantInput = z.object({ expectedRevision: z.number().int().nonnegative() });

type GrantResult = { id: string; fieldGroup: string; granted: boolean; revision: number };
type GrantCommandResult = {
  grant: GrantResult;
  duplicate: boolean;
  receipt: Awaited<ReturnType<typeof writeCommandLedger>>;
};

export async function revokeParentGrant(
  actor: ActorContext,
  grantId: string,
  commandId: string,
  input: z.infer<typeof revokeGrantInput>,
): Promise<GrantCommandResult> {
  assertCommandId(commandId);
  z.string().uuid().parse(grantId);
  requireRole(actor, "student");
  if (!actor.studentId) throw new ConflictError("STUDENT_PROFILE_MISSING", "This identity has no active student profile");

  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return { grant: duplicate.payload.grant as GrantResult, duplicate: true, receipt: duplicate.receipt };
    const result = await client.query<{
      id: string;
      field_group: string;
      granted: boolean;
      revision: number;
      parent_person_id: string;
      department_id: string;
    }>(
      `SELECT grant_row.id, grant_row.field_group, grant_row.granted, grant_row.revision,
              link.parent_person_id, student.department_id
       FROM parent_field_grants grant_row
       JOIN parent_links link ON link.id = grant_row.parent_link_id AND link.generation_id = grant_row.generation_id AND link.active
       JOIN student_profiles student ON student.id = link.student_id AND student.generation_id = link.generation_id
       WHERE grant_row.generation_id = $1 AND grant_row.id = $2 AND link.student_id = $3
       FOR UPDATE OF grant_row`,
      [generationId, grantId, actor.studentId],
    );
    if (!result.rowCount) throw new NotFoundError("Parent grant not found");
    const grant = result.rows[0]!;
    if (grant.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "The grant changed after this page loaded");
    if (!grant.granted) throw new ConflictError("GRANT_ALREADY_REVOKED", "This field grant is already revoked");
    const updated = await client.query<{ revision: number }>(
      "UPDATE parent_field_grants SET granted = false, changed_at = now(), revision = revision + 1 WHERE id = $1 RETURNING revision",
      [grant.id],
    );
    const payload = {
      studentId: actor.studentId,
      departmentId: grant.department_id,
      parentPersonId: grant.parent_person_id,
      grant: { id: grant.id, fieldGroup: grant.field_group, granted: false, revision: updated.rows[0]!.revision },
    };
    const receipt = await writeCommandLedger(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "parent_field_grant",
      aggregateId: grant.id,
      eventType: "parent_grant.revoked",
      action: "revoke_parent_field_grant",
      topic: "relationship.parent_grant.revoked",
      payload,
      metadata: { expectedRevision: input.expectedRevision, fieldGroup: grant.field_group },
    });
    return { grant: payload.grant, duplicate: false, receipt };
  });
}
