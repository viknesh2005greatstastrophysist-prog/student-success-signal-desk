type Environment = Record<string, string | undefined>;

export const hostedCollegeSchemas = {
  core: "aura_hosted_project_core",
  identity: "aura_hosted_project_identity",
} as const;

/** The hosted project is explicitly authorized, separately from institutional verification. */
export function requireHostedCollegeEnvironment(env: Environment = process.env): void {
  const database = new URL(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL ?? "http://invalid");
  if (
    env.AURA_HOSTED_COLLEGE_PROJECT !== "1" || env.AURA_LOCAL_PROJECT === "1" ||
    env.AURA_IDENTITY_MODE !== "college-project" ||
    env.CORE_IDENTITY_REALM !== "college-project" ||
    env.CORE_DATABASE_SCHEMA !== hostedCollegeSchemas.core ||
    env.AUTH_DATABASE_SCHEMA !== hostedCollegeSchemas.identity ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !env.COLLEGE_DATABASE_HOST || database.hostname !== env.COLLEGE_DATABASE_HOST ||
    ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
    !env.COLLEGE_DATABASE_NAME || database.pathname !== `/${env.COLLEGE_DATABASE_NAME}` ||
    !["require", "verify-full"].includes(database.searchParams.get("sslmode") ?? "")
  ) throw new Error("Hosted college project requires its approved TLS database and dedicated schemas");
}

export function isCollegeProject(env: Environment = process.env): boolean {
  return env.CORE_IDENTITY_REALM === "project" || env.CORE_IDENTITY_REALM === "college-project";
}
