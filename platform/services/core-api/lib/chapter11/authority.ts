import type { ActorContext } from "@aura/contracts";
import { requireRole } from "../security";

/**
 * Who may act on a student's support review (owner decision, 17 Oct; reverses
 * E2E #12 and the department-head parts of review R-12).
 *
 * The assigned mentor (role faculty) acts for their own mentees. The department
 * head (role hod) can do everything a mentor can for every student in their
 * department: start, lock, run and pause reviews, edit, approve and decline
 * drafts, record outcomes, restore versions, schedule follow-ups and approve
 * scoring policies for a mentor in the department. Every command already records
 * the actor, so a department-head action is traceable as theirs. The AI activity
 * workspace (role governance) never acts, and frozen records (frozen.ts) refuse
 * every change from everyone.
 */
export const REVIEW_ACTOR_ROLES = ["faculty", "hod"] as const;

export function requireReviewActor(actor: ActorContext) {
  requireRole(actor, ...REVIEW_ACTOR_ROLES);
}

/**
 * SQL condition: the actor may act on the student whose id is `student`. The
 * three placeholders hold the actor's role (text), person id and department id
 * (either may be null). Faculty: the student's assigned mentor. HoD: any student
 * in their department. Every other role matches nothing.
 */
export function actsOnStudentSql(student: string, role: string, person: string, department: string) {
  return `((${role}::text='hod' AND EXISTS(SELECT 1 FROM student_profiles scope_s WHERE scope_s.id=${student} AND scope_s.department_id=${department}::uuid))
    OR (${role}::text='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments scope_m WHERE scope_m.student_id=${student} AND scope_m.faculty_person_id=${person}::uuid)))`;
}

/** The parameter values for `actsOnStudentSql`, in its order (role, person, department). */
export function actorScopeParams(actor: ActorContext) {
  return [actor.role, actor.personId, actor.departmentId ?? null] as const;
}
