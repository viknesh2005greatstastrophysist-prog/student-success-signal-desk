import { actorContextSchema, portalOidcClients, type ActorContext } from "@aura/contracts";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";

import { loadCoreConfig } from "./config";
import { withCoreTransaction } from "./db";
import { AuthorizationError } from "./security";

export type AuthenticatedActor = ActorContext & {
  displayName: string;
  email: string;
  clientId: string;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrl = "";

function remoteJwks(url: string) {
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksUrl = url;
  }
  return jwks;
}

export class AuthenticationError extends Error {
  readonly status = 401;
  readonly code = "UNAUTHENTICATED";
}

export async function authenticateRequest(request: Request): Promise<AuthenticatedActor> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError("A bearer token is required");
  const token = authorization.slice(7);
  const config = loadCoreConfig();

  let subject: string;
  let clientId: string;
  try {
    const verified = await jwtVerify(token, remoteJwks(config.oidcJwksUrl), {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience,
      typ: "at+jwt",
    });
    if (!verified.payload.sub) throw new AuthenticationError("Token subject is missing");
    const rawClient = verified.payload.client_id ?? verified.payload.azp;
    if (typeof rawClient !== "string") throw new AuthenticationError("Token client is missing");
    subject = verified.payload.sub;
    clientId = rawClient;
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    if (error instanceof joseErrors.JOSEError) throw new AuthenticationError("Token validation failed");
    throw error;
  }

  const actor = await withCoreTransaction(async (client) => {
    const result = await client.query<{
      person_id: string;
      display_name: string;
      email: string;
      role: ActorContext["role"];
      department_id: string | null;
      student_id: string | null;
    }>(
      `SELECT p.id AS person_id, p.display_name, p.email, r.role, r.department_id, sp.id AS student_id
       FROM institution_revisions ir
       JOIN people p ON p.generation_id = ir.current_generation_id
       JOIN role_assignments r ON r.generation_id = ir.current_generation_id AND r.person_id = p.id AND r.active
       LEFT JOIN student_profiles sp ON sp.generation_id = ir.current_generation_id AND sp.person_id = p.id
       WHERE ir.singleton = true AND p.external_subject = $1
       LIMIT 2`,
      [subject],
    );
    if (result.rowCount !== 1) throw new AuthenticationError("Identity has no unique active Core assignment");
    const row = result.rows[0]!;
    const context = actorContextSchema.parse({
      subject,
      role: row.role,
      personId: row.person_id,
      departmentId: row.department_id ?? undefined,
      studentId: row.student_id ?? undefined,
    });
    return { ...context, displayName: row.display_name, email: row.email, clientId };
  });

  if (portalOidcClients[actor.role] !== clientId) {
    throw new AuthorizationError(`The ${actor.role} identity cannot enter this portal client`);
  }
  return actor;
}
