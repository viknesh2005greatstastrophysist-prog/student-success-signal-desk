import type { ActorContext, ActorRole } from "@aura/contracts";

export class AuthorizationError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
}

export function requireSyntheticInstitution(env: Record<string, string | undefined> = process.env): void {
  if (env.CORE_IDENTITY_REALM === "institutional" || env.CORE_DATABASE_SCHEMA?.startsWith("aura_college_")) throw new AuthorizationError("Synthetic fixture, reset and payment actions are disabled in the institutional realm");
}

export function requireDemoInstitution(env: Record<string,string|undefined> = process.env):void{
  requireSyntheticInstitution(env);
  if(["project","college-project"].includes(env.CORE_IDENTITY_REALM??"") || env.CORE_DATABASE_SCHEMA?.startsWith("aura_hosted_project_") || env.CORE_DATABASE_SCHEMA?.startsWith("aura_project_"))throw new AuthorizationError("Demo reset, population and legacy policy execution are disabled in the project workspace");
}

export function requireSandboxInvoiceOrigin(origin: string, env: Record<string,string|undefined> = process.env):void {
  requireSyntheticInstitution(env);
  if((env.CORE_IDENTITY_REALM === "college-project" || env.CORE_DATABASE_SCHEMA?.startsWith("aura_hosted_project_")) && origin !== "generated_project_operations")
    throw new AuthorizationError("Simulated payments cannot update an actual or unverified college invoice");
}

export function requireRole(actor: ActorContext, ...allowed: ActorRole[]): void {
  if (!allowed.includes(actor.role)) {
    throw new AuthorizationError(`Role ${actor.role} is not permitted for this operation`);
  }
}

export function requireStudentScope(actor: ActorContext, studentId: string): void {
  requireRole(actor, "student");
  if (actor.studentId !== studentId) {
    throw new AuthorizationError("A student can access only their own record");
  }
}

export function requireDepartmentScope(actor: ActorContext, departmentId: string): void {
  requireRole(actor, "hod");
  if (actor.departmentId !== departmentId) {
    throw new AuthorizationError("A HOD can access only their assigned department");
  }
}

export function requireGovernanceRead(actor: ActorContext): void {
  requireRole(actor, "governance");
}

export function rejectGovernanceMutation(actor: ActorContext): void {
  if (actor.role === "governance") {
    throw new AuthorizationError("Governance operators cannot mutate academic records");
  }
}
