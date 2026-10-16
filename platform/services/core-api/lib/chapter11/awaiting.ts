/** The single definition of "awaiting decision" (E2E log #1, #2, #9).
 *
 * A case is awaiting when it is open (`awaiting_faculty`), has a job in this
 * generation and carries an active AI draft: the latest model run's latest
 * artifact. Legacy rule-based drafts are never counted. A student appears once,
 * with the most recent such draft.
 *
 * An open case is superseded (review R-06) when the same student has a later
 * review in this generation: a job created after the case's own job that has
 * finished one way or another (not flagged, drafted, failed, blocked or handed
 * to the mentor), or a later case without a job. This is the same "latest
 * review per student" that AI activity and the department head's list use, so
 * an older draft never stays at the gate after a newer review, and approving
 * the latest draft cannot resurface an older one. A review still queued or
 * running does not supersede anything yet. The rule is read-side only: nothing
 * is written and no status changes. Frozen records (frozen.ts) are listed as
 * they are. Mentor Overview, Support reviews, the department overview and the
 * review queue all call this module. */
import type { PoolClient } from "pg";
import type { ActorContext } from "@aura/contracts";
import { frozenCaseIds, frozenRegisterNumbers } from "./frozen";

export type AwaitingDraft = {
  case_id: string;
  student_id: string;
  opened_at: string | Date;
  run_id: string;
  artifact_id: string;
  artifact_version: number;
  drafted_at: string | Date;
};
export type AwaitingGroup<T extends AwaitingDraft = AwaitingDraft> = {
  current: T;
  earlier: T[];
};

const time = (value: string | Date) => new Date(value).getTime();

/** One group per student: newest draft is current, the rest are history. */
export function collapseAwaiting<T extends AwaitingDraft>(
  rows: T[],
): AwaitingGroup<T>[] {
  const byStudent = new Map<string, T[]>();
  for (const row of rows)
    byStudent.set(row.student_id, [...(byStudent.get(row.student_id) ?? []), row]);
  return [...byStudent.values()]
    .map((list) => {
      const sorted = [...list].sort(
        (a, b) =>
          time(b.drafted_at) - time(a.drafted_at) ||
          time(b.opened_at) - time(a.opened_at),
      );
      return { current: sorted[0]!, earlier: sorted.slice(1) };
    })
    .sort((a, b) => time(b.current.drafted_at) - time(a.current.drafted_at));
}

export async function awaitingCases(
  client: PoolClient,
  generation: string,
  actor: Pick<ActorContext, "role" | "personId" | "departmentId">,
): Promise<AwaitingGroup[]> {
  const rows = await client.query<AwaitingDraft>(
    `SELECT DISTINCT ON (c.id) c.id AS case_id,c.student_id,c.opened_at,r.id AS run_id,a.id AS artifact_id,a.artifact_version,a.created_at AS drafted_at
     FROM support_cases c JOIN student_profiles s ON s.id=c.student_id
     JOIN agent_runs r ON r.support_case_id=c.id AND r.mode='model'
     JOIN agent_artifacts a ON a.agent_run_id=r.id
     WHERE c.generation_id=$1 AND c.status='awaiting_faculty'
     AND EXISTS(SELECT 1 FROM ch11_jobs j WHERE j.support_case_id=c.id AND j.generation_id=$1)
     AND ($2='governance' OR s.department_id=$3)
     AND ($2<>'faculty' OR EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.student_id=s.id AND m.faculty_person_id=$4))
     AND (lower(c.id::text)=ANY($5::text[]) OR upper(s.register_number)=ANY($6::text[]) OR (
       NOT EXISTS(SELECT 1 FROM ch11_jobs own JOIN ch11_jobs later ON later.student_id=own.student_id AND later.generation_id=own.generation_id AND later.created_at>own.created_at
         WHERE own.support_case_id=c.id AND own.generation_id=$1 AND (later.status IN ('not_flagged','awaiting_faculty','failed','blocked') OR later.escalated_at IS NOT NULL))
       AND NOT EXISTS(SELECT 1 FROM support_cases later WHERE later.student_id=c.student_id AND later.generation_id=c.generation_id AND later.opened_at>c.opened_at
         AND NOT EXISTS(SELECT 1 FROM ch11_jobs j WHERE j.support_case_id=later.id))))
     ORDER BY c.id,r.started_at DESC,a.artifact_version DESC`,
    [generation, actor.role, actor.departmentId ?? null, actor.personId, frozenCaseIds(), frozenRegisterNumbers()],
  );
  return collapseAwaiting(rows.rows);
}

export async function awaitingCount(
  client: PoolClient,
  generation: string,
  actor: Pick<ActorContext, "role" | "personId" | "departmentId">,
): Promise<number> {
  return (await awaitingCases(client, generation, actor)).length;
}
