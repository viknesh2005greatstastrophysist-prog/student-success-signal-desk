import { createHash, randomBytes, randomUUID } from "node:crypto";
import { portalIdSchema } from "@aura/contracts";
import { AccessError, bindActorToPortal, type Query } from "./portal-session";

/**
 * Remembered devices ("Keep me signed in on this device").
 *
 * - One random 32-byte token per workspace sign-in; only its SHA-256 is stored.
 * - Bound to one account (`user_id`) and one workspace (`portal`); a token presented
 *   for another workspace is not found.
 * - Valid for 7 days. Each use replaces it with a new token; the previous one stays
 *   valid for a short grace period so two tabs opened at the same moment both work.
 * - Redeeming it repeats every check of a normal sign-in: the password it was issued
 *   under must still be the current one, and the account must still hold a role that
 *   the workspace allows.
 * - Sign-out revokes every token of that account in that workspace.
 *
 * The statements below are idempotent and identical to migrations/012_device_tokens.sql
 * (a test compares them); the Streamlit engine applies them at start-up, because the
 * deployed engine does not run the Core migrations.
 */
export const DEVICE_TOKEN_TTL_DAYS = 7;
export const DEVICE_TOKEN_GRACE_SECONDS = 120;

export const DEVICE_TOKENS_DDL = [
  `CREATE TABLE IF NOT EXISTS device_tokens (id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id text NOT NULL, portal text NOT NULL, credential_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, last_used_at timestamptz, rotated_at timestamptz, replaced_by uuid, revoked_at timestamptz)`,
  `CREATE INDEX IF NOT EXISTS device_tokens_account_idx ON device_tokens (user_id, portal) WHERE revoked_at IS NULL`,
];

/** 32 random bytes as base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const hashDeviceToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const isDeviceTokenShape = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_SHAPE.test(value);

export type DeviceTokenIssue = { token: string; expiresAt: string };

/** Stores a new device token for an account that has just signed in (or is being
 * rotated) and returns the token once; the database keeps only its hash. */
export async function issueDeviceToken(
  c: Query,
  input: { userId: string; portal: string; credentialHash: string },
): Promise<DeviceTokenIssue> {
  const portal = portalIdSchema.parse(input.portal);
  const token = randomBytes(32).toString("base64url");
  const row = (
    await c.query(
      `INSERT INTO device_tokens(id,token_hash,user_id,portal,credential_hash,expires_at,last_used_at) VALUES($1,$2,$3,$4,$5,now()+make_interval(days=>$6),now()) RETURNING expires_at`,
      [randomUUID(), hashDeviceToken(token), input.userId, portal, input.credentialHash, DEVICE_TOKEN_TTL_DAYS],
    )
  ).rows[0];
  return { token, expiresAt: new Date(row.expires_at).toISOString() };
}

export type RememberedDevice = {
  portal: string;
  userId: string;
  credentialHash: string;
  lastUsedAt: string;
};

/** The valid (unrevoked, unexpired, workspace-matching) tokens among those a browser
 * holds, newest use first. Changes nothing. */
export async function findDeviceTokens(
  c: Query,
  held: Record<string, string>,
): Promise<RememberedDevice[]> {
  const pairs = new Set<string>();
  for (const [portal, token] of Object.entries(held)) {
    if (isDeviceTokenShape(token) && portalIdSchema.safeParse(portal).success)
      pairs.add(`${hashDeviceToken(token)}:${portal}`);
  }
  if (!pairs.size) return [];
  const rows = (
    await c.query(
      `SELECT token_hash,portal,user_id,credential_hash,COALESCE(last_used_at,created_at) AS used_at FROM device_tokens WHERE token_hash=ANY($1) AND revoked_at IS NULL AND expires_at>now() ORDER BY used_at DESC`,
      [[...new Set([...pairs].map((pair) => pair.split(":")[0]))]],
    )
  ).rows;
  return rows
    .filter((row) => pairs.has(`${row.token_hash}:${row.portal}`))
    .map((row) => ({
      portal: row.portal,
      userId: row.user_id,
      credentialHash: row.credential_hash,
      lastUsedAt: new Date(row.used_at).toISOString(),
    }));
}

export type DeviceRedeem =
  | {
      ok: true;
      userId: string;
      actor: Awaited<ReturnType<typeof bindActorToPortal>>;
      /** The replacement token to store in the browser; absent while the presented
       * token is inside the grace period of an earlier rotation. */
      rotated?: DeviceTokenIssue;
    }
  | { ok: false; reason: "unknown" | "credential_changed" | "denied"; error?: AccessError };

/**
 * Validates a remembered-device token for a workspace exactly as a sign-in would
 * (credential still current, role and scope allowed) and rotates it. Failures after
 * the token was found revoke it. Failures are returned, not thrown, so the caller's
 * transaction still commits the revocation.
 */
export async function redeemDeviceToken(
  c: Query,
  input: {
    token: string;
    portal: string;
    /** The account's current credential hash, or null when the account is gone. */
    credentialHashFor: (userId: string) => Promise<string | null>;
  },
): Promise<DeviceRedeem> {
  const portal = portalIdSchema.parse(input.portal);
  if (!isDeviceTokenShape(input.token)) return { ok: false, reason: "unknown" };
  const row = (
    await c.query(
      `SELECT id,user_id,credential_hash,rotated_at FROM device_tokens WHERE token_hash=$1 AND portal=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
      [hashDeviceToken(input.token), portal],
    )
  ).rows[0];
  if (!row) return { ok: false, reason: "unknown" };
  const revoke = () =>
    c.query(`UPDATE device_tokens SET revoked_at=now() WHERE id=$1`, [row.id]);
  const current = await input.credentialHashFor(row.user_id);
  if (current === null || current !== row.credential_hash) {
    await revoke();
    return { ok: false, reason: "credential_changed" };
  }
  let actor: Awaited<ReturnType<typeof bindActorToPortal>>;
  try {
    actor = await bindActorToPortal(c, row.user_id, portal);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    await revoke();
    return { ok: false, reason: "denied", error };
  }
  if (row.rotated_at) {
    await c.query(`UPDATE device_tokens SET last_used_at=now() WHERE id=$1`, [row.id]);
    return { ok: true, userId: row.user_id, actor };
  }
  const rotated = await issueDeviceToken(c, {
    userId: row.user_id,
    portal,
    credentialHash: current,
  });
  await c.query(
    `UPDATE device_tokens SET rotated_at=now(),last_used_at=now(),expires_at=LEAST(expires_at,now()+make_interval(secs=>$2)),replaced_by=(SELECT id FROM device_tokens WHERE token_hash=$3) WHERE id=$1`,
    [row.id, DEVICE_TOKEN_GRACE_SECONDS, hashDeviceToken(rotated.token)],
  );
  return { ok: true, userId: row.user_id, actor, rotated };
}

/** Sign-out: revokes every remembered-device token of this account in this workspace
 * (and the one the browser named, if it is another account's leftover). */
export async function revokeDeviceTokens(
  c: Query,
  input: { userId: string; portal: string; token?: string },
): Promise<number> {
  const result = await c.query(
    `UPDATE device_tokens SET revoked_at=now() WHERE revoked_at IS NULL AND ((user_id=$1 AND portal=$2) OR token_hash=$3)`,
    [input.userId, input.portal, input.token && isDeviceTokenShape(input.token) ? hashDeviceToken(input.token) : ""],
  );
  return result.rowCount ?? 0;
}

/** Housekeeping: rows are kept a day past expiry or revocation, then removed. */
export async function purgeDeviceTokens(c: Query): Promise<number> {
  const result = await c.query(
    `DELETE FROM device_tokens WHERE expires_at<now()-interval '1 day' OR revoked_at<now()-interval '1 day'`,
  );
  return result.rowCount ?? 0;
}
