import { requireHostedCollegeEnvironment } from "@aura/contracts";
export function identityMode(env: Record<string, string | undefined> = process.env): "demo" | "institutional" | "project" | "college-project" {
  const mode = env.AURA_IDENTITY_MODE ?? "demo";
  if(env.AURA_HOSTED_COLLEGE_PROJECT === "1" || env.CORE_IDENTITY_REALM === "college-project" || env.AUTH_DATABASE_SCHEMA?.startsWith("aura_hosted_project_")) requireHostedCollegeEnvironment(env);
  if (mode !== "demo" && mode !== "institutional" && mode !== "project" && mode !== "college-project") throw new Error("Invalid identity mode");
  if (mode === "project" && env.AURA_LOCAL_PROJECT !== "1") throw new Error("Project identities require the private local runtime");
  if (mode === "project") {
    const url = new URL(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL ?? "http://invalid");
    if(url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/aura_project" || env.AUTH_DATABASE_SCHEMA !== "aura_project_identity" || env.CORE_DATABASE_SCHEMA !== "aura_project_core") throw new Error("Project identities require their dedicated local database and schemas");
  }
  if(mode === "college-project") requireHostedCollegeEnvironment(env);
  return mode;
}
