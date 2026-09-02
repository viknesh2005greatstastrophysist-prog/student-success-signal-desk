import assert from "node:assert/strict";
import test from "node:test";
import type { ActorContext } from "@aura/contracts";
import {
  AuthorizationError,
  rejectGovernanceMutation,
  requireDepartmentScope,
  requireGovernanceRead,
  requireStudentScope,
} from "../lib/security";

const studentId = "00000000-0000-4000-8000-000000000001";
const departmentId = "00000000-0000-4000-8000-000000000002";

function actor(role: ActorContext["role"], additions: Partial<ActorContext> = {}): ActorContext {
  return {
    subject: `aura-demo-${role}`,
    role,
    personId: "00000000-0000-4000-8000-000000000003",
    ...additions,
  };
}

test("student scope is deny-by-default", () => {
  assert.doesNotThrow(() => requireStudentScope(actor("student", { studentId }), studentId));
  assert.throws(
    () => requireStudentScope(actor("student", { studentId }), "00000000-0000-4000-8000-000000000099"),
    AuthorizationError,
  );
  assert.throws(() => requireStudentScope(actor("parent", { studentId }), studentId), AuthorizationError);
});

test("HOD department scope rejects cross-department access", () => {
  assert.doesNotThrow(() => requireDepartmentScope(actor("hod", { departmentId }), departmentId));
  assert.throws(
    () => requireDepartmentScope(actor("hod", { departmentId }), "00000000-0000-4000-8000-000000000099"),
    AuthorizationError,
  );
});

test("governance is read-only at the academic boundary", () => {
  const governance = actor("governance");
  assert.doesNotThrow(() => requireGovernanceRead(governance));
  assert.throws(() => rejectGovernanceMutation(governance), AuthorizationError);
  assert.throws(() => requireGovernanceRead(actor("faculty")), AuthorizationError);
});
