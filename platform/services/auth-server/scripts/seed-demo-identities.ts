import { Pool } from "pg";

import { auth } from "../lib/auth";
import { demoPersonas } from "../lib/demo-personas";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const identitySchema = process.env.AUTH_DATABASE_SCHEMA ?? "aura_identity";
const coreSchema = process.env.CORE_DATABASE_SCHEMA ?? "aura_core";
const password = process.env.DEMO_PERSONA_PASSWORD;

if (!databaseUrl) throw new Error("Database URL is required");
if (!password || password.length < 16) throw new Error("DEMO_PERSONA_PASSWORD must contain at least 16 characters");
if (!/^[a-z][a-z0-9_]{2,62}$/.test(identitySchema) || !/^[a-z][a-z0-9_]{2,62}$/.test(coreSchema)) {
  throw new Error("Database schema name is invalid");
}

const pool = new Pool({ connectionString: databaseUrl });
let created = 0;
let linked = 0;

try {
  for (const persona of demoPersonas) {
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM "${identitySchema}"."user" WHERE email = $1 LIMIT 1`,
      [persona.email],
    );
    if (!existing.rowCount) {
      const response = await auth.api.signUpEmail({
        asResponse: true,
        body: { email: persona.email, name: persona.name, password },
      });
      if (!response.ok) throw new Error(`Could not seed ${persona.portal} identity (${response.status})`);
      created += 1;
    }

    const user = await pool.query<{ id: string }>(
      `SELECT id FROM "${identitySchema}"."user" WHERE email = $1 LIMIT 1`,
      [persona.email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error(`Seeded ${persona.portal} identity could not be read back`);

    const update = await pool.query(
      `UPDATE "${coreSchema}".people
       SET external_subject = $1
       WHERE generation_id = (
         SELECT current_generation_id FROM "${coreSchema}".institution_revisions WHERE singleton = true
       ) AND email = $2`,
      [userId, persona.email],
    );
    if (update.rowCount !== 1) throw new Error(`Core persona link failed for ${persona.portal}`);
    linked += 1;
  }
} finally {
  await pool.end();
}

process.stdout.write(`AURA demo identities ready: ${created} created, ${linked} linked.\n`);
