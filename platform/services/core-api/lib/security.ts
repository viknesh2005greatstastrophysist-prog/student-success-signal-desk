import type { ActorContext, ActorRole } from "@aura/contracts";

export class AuthorizationError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
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
