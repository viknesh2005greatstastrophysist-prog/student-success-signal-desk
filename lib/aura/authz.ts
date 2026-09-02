import type { PoolClient } from "pg";

import { IDENTITIES, type Identity, type Role, type ViewerProfile } from "./runtime";

export type StoredProfile = ViewerProfile & { clerkUserId: string };

function profileIdentity(profile: StoredProfile): Identity {
  const matching = IDENTITIES.find((identity) => {
    if (identity.role !== profile.role) return false;
    if (profile.role === "MENTOR") return identity.mentorId === profile.mentorId;
    if (profile.role === "STUDENT" || profile.role === "PARENT") return identity.studentRef === profile.studentRef;
    return true;
  });
  if (matching) return matching;
  return {
    id: `account-${profile.role.toLowerCase()}`,
    label: profile.displayName,
    role: profile.role,
    mentorId: profile.mentorId,
    studentRef: profile.studentRef,
  };
}

export async function ensureProfile(client: PoolClient, clerkUserId: string): Promise<StoredProfile> {
  await client.query("SELECT pg_advisory_xact_lock(84172026)");
  const existing = await client.query<{
    clerk_user_id: string;
    role: Role;
    display_name: string;
    mentor_id: string | null;
    student_ref: string | null;
  }>("SELECT clerk_user_id, role, display_name, mentor_id, student_ref FROM aura_user_profiles WHERE clerk_user_id = $1 AND active", [clerkUserId]);

  if (!existing.rows[0]) {
    const count = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM aura_user_profiles WHERE active");
    const firstAccount = Number(count.rows[0]?.count ?? 0) === 0;
    const role: Role = firstAccount ? "OPERATIONS" : "STUDENT";
    const displayName = firstAccount ? "AURA Operations Owner" : "Synthetic Student Account";
    const studentRef = firstAccount ? null : "SYN-0002";
    await client.query(
      `INSERT INTO aura_user_profiles (clerk_user_id, role, display_name, student_ref)
       VALUES ($1, $2, $3, $4)`,
      [clerkUserId, role, displayName, studentRef],
    );
    await client.query(
      `INSERT INTO aura_role_assignments (clerk_user_id, role, student_ref, assigned_by, reason)
       VALUES ($1, $2, $3, 'runtime/bootstrap', $4)`,
      [clerkUserId, role, studentRef, firstAccount ? "First authenticated account bootstraps the prototype owner" : "Safe default role for a newly authenticated prototype account"],
    );
  }

  const result = await client.query<{
    clerk_user_id: string;
    role: Role;
    display_name: string;
    mentor_id: string | null;
    student_ref: string | null;
  }>("SELECT clerk_user_id, role, display_name, mentor_id, student_ref FROM aura_user_profiles WHERE clerk_user_id = $1 AND active", [clerkUserId]);
  const row = result.rows[0];
  if (!row) throw new Error("No active application role is assigned to this account");
  return {
    clerkUserId: row.clerk_user_id,
    role: row.role,
    displayName: row.display_name,
    mentorId: row.mentor_id ?? undefined,
    studentRef: row.student_ref ?? undefined,
    canPreview: row.role === "OPERATIONS",
  };
}

export function resolveView(profile: StoredProfile, requestedIdentityId?: string | null): { identity: Identity; available: Identity[] } {
  const ownIdentity = profileIdentity(profile);
  if (profile.role !== "OPERATIONS") return { identity: ownIdentity, available: [ownIdentity] };
  const requested = IDENTITIES.find((identity) => identity.id === requestedIdentityId) ?? IDENTITIES[0];
  return { identity: requested, available: IDENTITIES };
}

export function requireActorRole(profile: StoredProfile, roles: Role[]): void {
  if (!roles.includes(profile.role)) throw new Error("The authenticated account is not authorised for that action");
}

export async function assignRole(
  client: PoolClient,
  actor: StoredProfile,
  input: { targetUserId?: string; role?: Role; mentorId?: string; studentRef?: string; rationale?: string },
): Promise<void> {
  requireActorRole(actor, ["OPERATIONS"]);
  if (!input.targetUserId || input.targetUserId.length > 128) throw new Error("A valid target account ID is required");
  const allowed: Role[] = ["OPERATIONS", "MENTOR", "LEADERSHIP", "STUDENT", "PARENT"];
  if (!input.role || !allowed.includes(input.role)) throw new Error("A valid application role is required");
  if (input.role === "MENTOR" && !["mentor-01", "mentor-02"].includes(input.mentorId ?? "")) throw new Error("A mentor assignment is required");
  if (["STUDENT", "PARENT"].includes(input.role) && !/^SYN-000[1-6]$/.test(input.studentRef ?? "")) throw new Error("A synthetic student assignment is required");

  const target = await client.query("SELECT 1 FROM aura_user_profiles WHERE clerk_user_id = $1 AND active", [input.targetUserId]);
  if (!target.rowCount) throw new Error("The target account must sign in once before role provisioning");
  const mentorId = input.role === "MENTOR" ? input.mentorId : null;
  const studentRef = ["STUDENT", "PARENT"].includes(input.role) ? input.studentRef : null;
  await client.query(
    `UPDATE aura_user_profiles
     SET role = $2, mentor_id = $3, student_ref = $4, display_name = $5
     WHERE clerk_user_id = $1`,
    [input.targetUserId, input.role, mentorId, studentRef, `Prototype ${input.role.toLowerCase()} account`],
  );
  await client.query(
    `INSERT INTO aura_role_assignments (clerk_user_id, role, mentor_id, student_ref, assigned_by, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.targetUserId, input.role, mentorId, studentRef, actor.clerkUserId, input.rationale?.slice(0, 300) || "Explicit prototype role provisioning"],
  );
}
