import { z } from "zod";

const schemaName = z.string().regex(/^[a-z][a-z0-9_]{2,62}$/);

export type CoreConfig = {
  databaseUrl: string;
  databaseSchema: string;
  resetConfirmation: string;
  oidcIssuer: string;
  oidcJwksUrl: string;
  oidcAudience: string;
};

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const databaseUrl = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required for database operations");
  }

  const databaseSchema = schemaName.parse(env.CORE_DATABASE_SCHEMA ?? "aura_core");

  return {
    databaseUrl,
    databaseSchema,
    resetConfirmation: env.CORE_RESET_CONFIRMATION ?? "AURA-SYNTHETIC-SEED-V1",
    oidcIssuer: env.CORE_OIDC_ISSUER ?? "http://localhost:3200/api/auth",
    oidcJwksUrl: env.CORE_OIDC_JWKS_URL ?? "http://localhost:3200/api/auth/jwks",
    oidcAudience: env.CORE_API_AUDIENCE ?? "aura-core-api",
  };
}

export function quoteIdentifier(value: string): string {
  return `"${schemaName.parse(value)}"`;
}
