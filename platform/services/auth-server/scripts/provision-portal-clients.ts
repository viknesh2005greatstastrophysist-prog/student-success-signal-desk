import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { portalOidcClients } from "@aura/contracts";

import { auth } from "../lib/auth";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const databaseSchema = process.env.AUTH_DATABASE_SCHEMA ?? "aura_identity";

if (!databaseUrl) throw new Error("Database URL is required");

const clients = [
  { id: "student", name: "AURA Student Portal", port: 3101, domain: "aura-student-portal.vercel.app" },
  { id: "parent", name: "AURA Parent Portal", port: 3102, domain: "aura-parent-portal.vercel.app" },
  { id: "faculty", name: "AURA Faculty Portal", port: 3103, domain: "aura-faculty-portal.vercel.app" },
  { id: "hod", name: "AURA HOD Portal", port: 3104, domain: "aura-hod-portal.vercel.app" },
  { id: "governance", name: "AURA AI Governance", port: 3105, domain: "aura-ai-governance.vercel.app" },
] as const;

const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${databaseSchema}`,
});

const result: Record<string, string> = {};

try {
  const missing = [];
  for (const client of clients) {
    const existing = await pool.query<{ clientId: string }>(
      'SELECT "clientId" FROM "oauthClient" WHERE "name" = $1 LIMIT 1',
      [client.name],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].clientId !== portalOidcClients[client.id]) {
        throw new Error(`${client.name} client ID does not match the checked-in portal contract`);
      }
      await pool.query(
        `UPDATE "oauthClient" SET "redirectUris" = $2::jsonb, "postLogoutRedirectUris" = $3::jsonb, "updatedAt" = now()
         WHERE "clientId" = $1`,
        [
          existing.rows[0].clientId,
          JSON.stringify([`https://${client.domain}/api/auth/callback/aura`, `http://127.0.0.1:${client.port}/api/auth/callback/aura`]),
          JSON.stringify([`https://${client.domain}/`, `http://127.0.0.1:${client.port}/`]),
        ],
      );
      result[client.id] = existing.rows[0].clientId;
      continue;
    }

    missing.push(client);
  }

  if (missing.length) {
    const bootstrapPassword = `${randomBytes(30).toString("base64url")}aA1!`;
    const bootstrapResponse = await auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: `client-provisioner-${Date.now()}@aura.synthetic.test`,
        name: "Synthetic OAuth Client Provisioner",
        password: bootstrapPassword,
      },
    });
    if (!bootstrapResponse.ok) throw new Error(`Bootstrap session failed with ${bootstrapResponse.status}`);
    const cookie = bootstrapResponse.headers.get("set-cookie");
    if (!cookie) throw new Error("Bootstrap session did not return a cookie");
    const headers = new Headers({ cookie });

    for (const client of missing) {
      const created = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: client.name,
          redirect_uris: [
            `https://${client.domain}/api/auth/callback/aura`,
            `http://127.0.0.1:${client.port}/api/auth/callback/aura`,
          ],
          post_logout_redirect_uris: [
            `https://${client.domain}/`,
            `http://127.0.0.1:${client.port}/`,
          ],
          token_endpoint_auth_method: "none",
          application_type: "web",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          require_pkce: true,
          skip_consent: true,
          enable_end_session: true,
        },
      });
      result[client.id] = created.client_id;
    }
  }
} finally {
  await pool.end();
}

console.log(JSON.stringify(result, null, 2));
