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
  created_at?: string | Date | null;
  risk?: Risk | null;
};
const stamp = (job: RiskJob) =>
  job.created_at ? new Date(job.created_at).getTime() : 0;

/** Rows are student x review cycle. `latest` marks one row per student, the
 * count to use when students are what is being counted (E2E log #6): the newest
 * cycle that evaluated the student, or the newest cycle at all when none did.
 * Ties keep the first row seen; callers pass jobs newest first. */
export function compositeRiskView(students: ScopedStudent[], jobs: RiskJob[]) {
  const visible = new Map(students.map((student) => [student.id, student]));
  const scoped = jobs.filter((job) => visible.has(job.student_id));
  const latestJob = new Map<string, RiskJob>();
  for (const job of scoped) {
    const held = latestJob.get(job.student_id);
    const evaluated = job.risk?.score != null;
    const heldEvaluated = held?.risk?.score != null;
    if (
      !held ||
      (evaluated && !heldEvaluated) ||
      (evaluated === heldEvaluated && stamp(job) > stamp(held))
    )
      latestJob.set(job.student_id, job);
  }
  return scoped
    .map((job) => {
      const student = visible.get(job.student_id)!;
      return {
        jobId: job.id,
        planId: job.plan_id,
        latest: latestJob.get(job.student_id) === job,
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
