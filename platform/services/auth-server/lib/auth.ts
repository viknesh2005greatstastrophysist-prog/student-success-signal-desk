import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

import { coreApiAudience } from "@aura/contracts";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const baseURL = process.env.NODE_ENV === "production"
  ? process.env.BETTER_AUTH_URL ?? "https://aura-identity-service.vercel.app"
  : process.env.LOCAL_BETTER_AUTH_URL ?? "http://127.0.0.1:3200";
const databaseSchema = process.env.AUTH_DATABASE_SCHEMA ?? "aura_identity";

if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required by the AURA identity service");
if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required by the AURA identity service");
if (!/^[a-z][a-z0-9_]{2,62}$/.test(databaseSchema)) throw new Error("AUTH_DATABASE_SCHEMA is invalid");

const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${databaseSchema}`,
});

export const auth = betterAuth({
  appName: "AURA Identity Service",
  baseURL,
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    baseURL,
    "http://127.0.0.1:3101",
    "http://127.0.0.1:3102",
    "http://127.0.0.1:3103",
    "http://127.0.0.1:3104",
    "http://127.0.0.1:3105",
    "https://aura-student-portal.vercel.app",
    "https://aura-parent-portal.vercel.app",
    "https://aura-faculty-portal.vercel.app",
    "https://aura-hod-portal.vercel.app",
    "https://aura-ai-governance.vercel.app",
  ],
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "offline_access"],
      resources: [{ identifier: coreApiAudience, allowedScopes: ["openid", "profile", "email", "offline_access"] }],
      enforcePerClientResources: false,
    }),
  ],
});
