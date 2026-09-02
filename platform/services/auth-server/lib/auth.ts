import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3200";
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
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
    }),
  ],
});
