/** Projections consume only records already authorized by the Core query layer. */
import type { Risk } from "./engine";
export type ScopedStudent = {
  id: string;
  display_name: string;
  register_number: string;
  mentor_name?: string;
};
export type RiskJob = {
  id: string;
  plan_id: string;
  student_id: string;
  status: string;
  stage: string;
  risk?: Risk | null;
};
export function compositeRiskView(students: ScopedStudent[], jobs: RiskJob[]) {
  const visible = new Map(students.map((student) => [student.id, student]));
  return jobs
    .filter((job) => visible.has(job.student_id))
    .map((job) => {
      const student = visible.get(job.student_id)!;
      return {
        jobId: job.id,
        planId: job.plan_id,
        studentId: student.id,
        studentName: student.display_name,
        registerNumber: student.register_number,
        score: job.risk?.score ?? null,
        band: job.risk?.band ?? "not evaluated",
        flagged: job.risk?.flagged ?? false,
        signals: job.risk?.signals ?? [],
        policyVersion: job.risk?.policyVersion ?? null,
        status: job.status,
        reviewPath: student.mentor_name
          ? `Assigned mentor: ${student.mentor_name}. Review is required before publication.`
          : "Assigned faculty mentor review is required before publication.",
      };
    });
}
