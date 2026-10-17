/**
 * Meeting records after a support plan (owner request, 17 Oct): proof that the
 * mentor actually spoke to the student, not a recheck of the figures.
 *
 * - When a draft is approved (by the mentor or the department head) one check-in
 *   is created for that student and plan, due on the approval day plus the plan's
 *   earliest "within N days" action window (7 when it has none). It is assigned to
 *   the student's mentor even when the department head approved, and shared with
 *   the family (they see its date and note, never a meeting's reasons). No second
 *   check-in is created while one for the plan is still open.
 * - `record-meeting` (experience-commands.ts) completes that check-in with the day
 *   they met, the reasons the student gave from the fixed list below, a note and
 *   what was agreed next (table support_meetings, migration 014).
 * - Plans approved before this change get their check-in from the backfill
 *   (scripts/backfill-meeting-checkins.ts), due 7 days after their approval.
 *
 * Dates are calendar days in the college's time zone (India), so an approval at
 * 00:30 IST counts on that day even though the server clock is still on the day before.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ConflictError } from "./http";
import { loadCoreConfig } from "./config";
import { frozenStudentIds } from "./chapter11/frozen";
import {
  caseEvidenceCapturedSql,
  isCurrentEvidence,
  loadGenerationClock,
} from "./data-refresh/generation";

/** The reasons a student can give, in the order the form lists them. */
export const MEETING_REASONS = [
  "Health",
  "Family responsibilities",
  "Financial pressure",
  "Transport or distance",
  "Course difficulty",
  "Lost motivation or interest",
  "Part-time work",
  "Personal or mental-health concern",
  "Timetable clash",
  "Other",
] as const;
export type MeetingReason = (typeof MEETING_REASONS)[number];
export const CHECKIN_NOTE = "Check-in after the support plan";
export const DEFAULT_CHECKIN_DAYS = 7;
export const COLLEGE_TIME_ZONE = "Asia/Kolkata";
/** A meeting this many days overdue is shown to the department head as overdue by more than a week. */
export const HEAD_NOTICE_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A calendar day (YYYY-MM-DD) in the college's time zone. */
export function collegeDate(at: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COLLEGE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** The plan's earliest "within N days" action window, or 7 days when it has none. */
export function checkinWindowDays(plan: unknown): number {
  const actions = (plan as { actions?: unknown } | null)?.actions;
  const windows = Array.isArray(actions)
    ? actions
        .map((action) => Number((action as { dueInDays?: unknown } | null)?.dueInDays))
        .filter((days) => Number.isInteger(days) && days > 0)
    : [];
  return windows.length ? Math.min(...windows) : DEFAULT_CHECKIN_DAYS;
}

/** When the check-in after an approval is due: the approval day plus the plan's earliest window. */
export function checkinDueOn(approvedAt: Date | string, plan: unknown): string {
  return addDays(collegeDate(approvedAt), checkinWindowDays(plan));
}

/** When the backfilled check-in of a plan approved before this change is due: 7 days after approval. */
export function backfillDueOn(approvedAt: Date | string): string {
  return addDays(collegeDate(approvedAt), DEFAULT_CHECKIN_DAYS);
}

/** "15 Oct 2026" */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** The check-in's outcome once the meeting is recorded: "Met on 15 Oct 2026". */
export function meetingOutcome(metOn: string): string {
  return `Met on ${dayLabel(metOn)}`;
}

export type MeetingInput = {
  metOn: string;
  reasons: string[];
  note?: string;
  agreedNextStep?: string;
};

/**
 * Checks a meeting record and returns it tidied: the day they met is a real date,
 * not in the future and not before the plan was approved; at least one reason from
 * the fixed list (kept in the list's order, each once); a note when the reason is
 * "Other". Each refusal is a plain sentence the form shows as it is.
 */
export function validateMeeting(
  input: MeetingInput,
  options: { today?: string; approvedOn?: string | null } = {},
) {
  const today = options.today ?? collegeDate();
  const metOn = String(input.metOn ?? "");
  if (!DAY.test(metOn) || Number.isNaN(Date.parse(`${metOn}T00:00:00Z`)) || new Date(`${metOn}T00:00:00Z`).toISOString().slice(0, 10) !== metOn)
    throw new ConflictError("MEETING_DATE_INVALID", "Enter the date you met the student.");
  if (metOn > today)
    throw new ConflictError("MEETING_DATE_IN_FUTURE", "The meeting date cannot be in the future.");
  if (options.approvedOn && metOn < options.approvedOn)
    throw new ConflictError(
      "MEETING_BEFORE_PLAN",
      `The meeting date is before the plan was approved on ${dayLabel(options.approvedOn)}.`,
    );
  const given = (input.reasons ?? []).map((reason) => String(reason));
  const unknown = given.filter((reason) => !(MEETING_REASONS as readonly string[]).includes(reason));
  if (unknown.length)
    throw new ConflictError("MEETING_REASON_UNKNOWN", "Choose the reasons from the list.");
  const reasons = MEETING_REASONS.filter((reason) => given.includes(reason));
  if (!reasons.length)
    throw new ConflictError("MEETING_REASON_REQUIRED", "Choose at least one reason the student gave.");
  const note = String(input.note ?? "").trim();
  if (reasons.includes("Other") && note.length < 3)
    throw new ConflictError("MEETING_NOTE_REQUIRED", "Add a note saying what the other reason was.");
  return { metOn, reasons: [...reasons] as MeetingReason[], note, agreedNextStep: String(input.agreedNextStep ?? "").trim() };
}

// Schemas where migration 014 is known to be applied. Only a positive answer is
// remembered, so the records appear as soon as the migration has run.
const ready = new Set<string>();
export async function meetingTablesPresent(client: PoolClient): Promise<boolean> {
  const schema = loadCoreConfig().databaseSchema;
  if (ready.has(schema)) return true;
  const row = await client.query<{ ok: boolean }>("SELECT to_regclass('support_meetings') IS NOT NULL AS ok");
  if (row.rows[0]?.ok) ready.add(schema);
  return !!row.rows[0]?.ok;
}
export const MEETINGS_NOT_READY =
  "Meeting records are not switched on yet: the database update (migration 014) has not run.";

/**
 * The check-in after an approval, unless one for the plan is still open. Assigned
 * to the student's mentor (`fallbackMentorId` when the student has none), shared
 * with the family, recorded in record_changes under the approver.
 */
export async function ensurePlanCheckin(
  client: PoolClient,
  input: {
    generation: string;
    planId: string;
    studentId: string;
    dueOn: string;
    fallbackMentorId: string;
    actorPersonId: string;
    reason: string;
  },
): Promise<{ created: boolean; id: string; dueOn: string; mentorPersonId: string | null }> {
  const open = await client.query<{ id: string; due_on: string; mentor_person_id: string }>(
    "SELECT id,due_on::text AS due_on,mentor_person_id FROM support_followups WHERE generation_id=$1 AND support_plan_id=$2 AND status<>'completed' ORDER BY due_on LIMIT 1",
    [input.generation, input.planId],
  );
  if (open.rowCount)
    return { created: false, id: open.rows[0]!.id, dueOn: open.rows[0]!.due_on, mentorPersonId: open.rows[0]!.mentor_person_id };
  const mentor =
    (
      await client.query<{ faculty_person_id: string }>(
        "SELECT faculty_person_id FROM mentor_assignments WHERE generation_id=$1 AND student_id=$2",
        [input.generation, input.studentId],
      )
    ).rows[0]?.faculty_person_id ?? input.fallbackMentorId;
  const id = randomUUID();
  const row = {
    id,
    student_id: input.studentId,
    support_plan_id: input.planId,
    mentor_person_id: mentor,
    due_on: input.dueOn,
    note: CHECKIN_NOTE,
    shared: true,
    status: "planned",
    outcome: "",
  };
  await client.query(
    "INSERT INTO support_followups(id,generation_id,student_id,support_plan_id,mentor_person_id,due_on,note,shared,status,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,true,'planned','')",
    [id, input.generation, input.studentId, input.planId, mentor, input.dueOn, CHECKIN_NOTE],
  );
  await client.query(
    "INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated) VALUES($1,$2,$3,'support_followups',$4,$5,NULL,$6::jsonb)",
    [randomUUID(), input.generation, input.actorPersonId, id, input.reason, JSON.stringify(row)],
  );
  return { created: true, id, dueOn: input.dueOn, mentorPersonId: mentor };
}

export type MeetingRecord = {
  id: string;
  followup_id: string;
  met_on: string;
  reasons: string[];
  note: string;
  agreed_next_step: string;
  recorded_by: string;
  recorded_at: string;
};
export type PlanMeetingFacts = {
  /** The newest meeting recorded for the plan, or null. */
  meeting: MeetingRecord | null;
  /** The plan's open check-in (else its latest), or null when it has none. */
  checkin: { id: string; due_on: string; status: string } | null;
  /** When the meeting is due: the check-in's date, else 7 days after the approval. */
  due_on: string | null;
  /** Days past that date in the college's time zone (0 on the day, negative before). */
  days_overdue: number | null;
};

/** Meeting record, check-in and due date for each plan (no access check: callers pass plans they may read). */
export async function planMeetingFacts(
  client: PoolClient,
  generation: string,
  planIds: string[],
  today: string = collegeDate(),
): Promise<Map<string, PlanMeetingFacts>> {
  const facts = new Map<string, PlanMeetingFacts>();
  if (!planIds.length) return facts;
  const base = await client.query<{
    plan_id: string;
    approved_at: Date | null;
    checkin_id: string | null;
    checkin_due_on: string | null;
    checkin_status: string | null;
  }>(
    `SELECT p.id AS plan_id,d.decided_at AS approved_at,f.id AS checkin_id,f.due_on::text AS checkin_due_on,f.status AS checkin_status
     FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id
     LEFT JOIN LATERAL (SELECT f.id,f.due_on,f.status FROM support_followups f WHERE f.generation_id=p.generation_id AND f.support_plan_id=p.id
       ORDER BY (f.status<>'completed') DESC,f.due_on DESC LIMIT 1) f ON true
     WHERE p.generation_id=$1 AND p.id=ANY($2::uuid[])`,
    [generation, planIds],
  );
  const meetings = new Map<string, MeetingRecord>();
  if (await meetingTablesPresent(client)) {
    const rows = await client.query<MeetingRecord & { support_plan_id: string }>(
      `SELECT DISTINCT ON (m.support_plan_id) m.support_plan_id,m.id,m.followup_id,m.met_on::text AS met_on,m.reasons,m.note,m.agreed_next_step,
         r.display_name AS recorded_by,m.recorded_at
       FROM support_meetings m JOIN people r ON r.id=m.recorded_by
       WHERE m.generation_id=$1 AND m.support_plan_id=ANY($2::uuid[]) ORDER BY m.support_plan_id,m.met_on DESC,m.recorded_at DESC`,
      [generation, planIds],
    );
    for (const row of rows.rows) {
      const { support_plan_id, ...meeting } = row;
      meetings.set(support_plan_id, meeting);
    }
  }
  for (const row of base.rows) {
    const due = row.checkin_due_on ?? (row.approved_at ? backfillDueOn(row.approved_at) : null);
    facts.set(row.plan_id, {
      meeting: meetings.get(row.plan_id) ?? null,
      checkin: row.checkin_id ? { id: row.checkin_id, due_on: row.checkin_due_on!, status: row.checkin_status! } : null,
      due_on: due,
      days_overdue: due ? daysBetween(due, today) : null,
    });
  }
  return facts;
}

export type MeetingStatusRow = PlanMeetingFacts & {
  plan_id: string;
  student_id: string;
  student_name: string;
  register_number: string;
  mentor_id: string | null;
  mentor_name: string | null;
  approved_at: string | null;
  /** True once the meeting is overdue by more than a week (the department head is told). */
  head_notice: boolean;
};

/**
 * The approved current plan of each student in scope with its meeting state:
 * each student's newest plan that is shown to the family (not withdrawn) and on
 * the current figures, the same plan the student and parent see (guardPlansForFamily).
 * Scope: a mentor's own mentees, or the department head's department.
 */
export async function meetingStatus(
  client: PoolClient,
  generation: string,
  actor: { role: string; personId: string; departmentId?: string | null },
  today: string = collegeDate(),
): Promise<MeetingStatusRow[]> {
  if (actor.role !== "faculty" && actor.role !== "hod") return [];
  const clock = await loadGenerationClock(client);
  const plans = await client.query<{
    plan_id: string;
    student_id: string;
    student_name: string;
    register_number: string;
    mentor_id: string | null;
    mentor_name: string | null;
    approved_at: Date | null;
    evidence_captured_at: Date | null;
  }>(
    `SELECT p.id AS plan_id,p.student_id,sp.display_name AS student_name,s.register_number,
       m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name,d.decided_at AS approved_at,
       ${caseEvidenceCapturedSql("p.support_case_id")} AS evidence_captured_at
     FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id AND d.decision='approved'
     JOIN student_profiles s ON s.id=p.student_id JOIN people sp ON sp.id=s.person_id
     LEFT JOIN mentor_assignments m ON m.generation_id=p.generation_id AND m.student_id=p.student_id
     LEFT JOIN people mp ON mp.id=m.faculty_person_id
     WHERE p.generation_id=$1 AND p.visible_to_student
       AND (($2::text='hod' AND s.department_id=$3::uuid) OR ($2::text='faculty' AND m.faculty_person_id=$4::uuid))
     ORDER BY p.created_at DESC`,
    [generation, actor.role, actor.departmentId ?? null, actor.personId],
  );
  // Each student's newest plan among those shown to the family and on the current
  // figures: exactly the plan the student and parent see.
  const seen = new Set<string>();
  const current = plans.rows.filter((row) => {
    if (seen.has(row.student_id) || !isCurrentEvidence(clock, row.evidence_captured_at)) return false;
    seen.add(row.student_id);
    return true;
  });
  const frozen = await frozenStudentIds(client, current.map((row) => row.student_id));
  const kept = current.filter((row) => !frozen.has(row.student_id));
  const facts = await planMeetingFacts(client, generation, kept.map((row) => row.plan_id), today);
  return kept
    .map((row) => {
      const fact = facts.get(row.plan_id) ?? { meeting: null, checkin: null, due_on: null, days_overdue: null };
      return {
        plan_id: row.plan_id,
        student_id: row.student_id,
        student_name: row.student_name,
        register_number: row.register_number,
        mentor_id: row.mentor_id,
        mentor_name: row.mentor_name,
        approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
        ...fact,
        head_notice: !fact.meeting && (fact.days_overdue ?? 0) >= HEAD_NOTICE_DAYS,
      };
    })
    .sort((a, b) => (b.days_overdue ?? -Infinity) - (a.days_overdue ?? -Infinity) || a.student_name.localeCompare(b.student_name));
}

export type MissingCheckin = { planId: string; studentId: string; approvedAt: Date; mentorId: string | null; fallbackMentorId: string };

/**
 * Plans approved before this change that still have no check-in: each student's
 * newest plan that is shown to the family and on the current figures, with no
 * follow-up linked to it. Frozen students (student 021) and excluded ones are left out.
 */
export async function loadMissingCheckins(
  client: PoolClient,
  generation: string,
  excludeStudentIds: string[] = [],
): Promise<MissingCheckin[]> {
  const clock = await loadGenerationClock(client);
  const rows = await client.query<{
    plan_id: string;
    student_id: string;
    approved_at: Date;
    mentor_id: string | null;
    decided_by: string;
    evidence_captured_at: Date | null;
    linked: boolean;
  }>(
    `SELECT p.id AS plan_id,p.student_id,d.decided_at AS approved_at,m.faculty_person_id AS mentor_id,d.faculty_person_id AS decided_by,
       ${caseEvidenceCapturedSql("p.support_case_id")} AS evidence_captured_at,
       EXISTS(SELECT 1 FROM support_followups f WHERE f.generation_id=p.generation_id AND f.support_plan_id=p.id) AS linked
     FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id AND d.decision='approved'
     LEFT JOIN mentor_assignments m ON m.generation_id=p.generation_id AND m.student_id=p.student_id
     WHERE p.generation_id=$1 AND p.visible_to_student
     ORDER BY p.created_at DESC`,
    [generation],
  );
  // Each student's newest plan shown to the family and on the current figures.
  const seen = new Set<string>();
  const current = rows.rows.filter((row) => {
    if (seen.has(row.student_id) || !isCurrentEvidence(clock, row.evidence_captured_at)) return false;
    seen.add(row.student_id);
    return !row.linked;
  });
  const frozen = await frozenStudentIds(client, current.map((row) => row.student_id));
  const excluded = new Set(excludeStudentIds);
  return current
    .filter((row) => !frozen.has(row.student_id) && !excluded.has(row.student_id))
    .map((row) => ({
      planId: row.plan_id,
      studentId: row.student_id,
      approvedAt: row.approved_at,
      mentorId: row.mentor_id,
      fallbackMentorId: row.mentor_id ?? row.decided_by,
    }));
}

export const BACKFILL_REASON = "Check-in after the support plan, added for a plan approved before meeting records";

/** Creates the missing check-ins (due 7 days after approval), recorded under `operatorId`. Counts only. */
export async function applyMissingCheckins(
  client: PoolClient,
  generation: string,
  missing: MissingCheckin[],
  operatorId: string,
  today: string = collegeDate(),
) {
  let created = 0;
  let overdue = 0;
  for (const plan of missing) {
    const dueOn = backfillDueOn(plan.approvedAt);
    const result = await ensurePlanCheckin(client, {
      generation,
      planId: plan.planId,
      studentId: plan.studentId,
      dueOn,
      fallbackMentorId: plan.fallbackMentorId,
      actorPersonId: operatorId,
      reason: BACKFILL_REASON,
    });
    if (result.created) {
      created += 1;
      if (dueOn < today) overdue += 1;
    }
  }
  return { created, alreadyOverdue: overdue };
}
