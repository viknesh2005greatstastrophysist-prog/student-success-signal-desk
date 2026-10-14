import type { PoolClient } from "pg";
import { actorContextSchema, portalAllowedRoles, portalIdSchema } from "@aura/contracts";

export type Query = Pick<PoolClient, "query">;

/** An expected refusal: it carries the code and HTTP status the caller reports. */
export class AccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

/**
 * Binds an authenticated account to a workspace: the one active college assignment
 * (role, department, student profile) must exist and the role must be allowed in
 * that workspace. Every way into a workspace (password sign-in, a stored session,
 * a remembered device) goes through this check.
 */
export async function bindActorToPortal(c: Query, userId: string, portal: string) {
  const result = await c.query(
    `SELECT p.id AS person_id,p.display_name,p.email,r.role,r.department_id,sp.id AS student_id FROM institution_revisions ir JOIN people p ON p.generation_id=ir.current_generation_id JOIN role_assignments r ON r.generation_id=ir.current_generation_id AND r.person_id=p.id AND r.active LEFT JOIN student_profiles sp ON sp.generation_id=ir.current_generation_id AND sp.person_id=p.id WHERE ir.singleton AND p.external_subject=$1 LIMIT 2`,
    [userId],
  );
  if (result.rowCount !== 1)
    throw new AccessError(
      "UNAUTHENTICATED",
      "Account has no unique active college assignment",
      401,
    );
  const row = result.rows[0]!;
  const actor = actorContextSchema.parse({
    subject: userId,
    personId: row.person_id,
    role: row.role,
    departmentId: row.department_id ?? undefined,
    studentId: row.student_id ?? undefined,
  });
  if (!portalAllowedRoles[portalIdSchema.parse(portal)].includes(actor.role))
    throw new AccessError(
      "PORTAL_DENIED",
      "This account cannot enter the selected workspace",
    );
  return { ...actor, displayName: row.display_name, email: row.email };
}
