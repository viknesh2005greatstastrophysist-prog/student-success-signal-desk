/**
 * The mentor's meeting with the student about the AI report (owner decisions, 17 Oct):
 * proof that the mentor actually talked to the student, not a recheck of the figures.
 *
 * - The clock starts when the AI generates the student's report: the draft reaches the
 *   mentor gate (the review job becomes awaiting_faculty and its support case opens).
 *   One check-in is created then for that case (`ensureCaseCheckin`, called from the
 *   publish step in chapter11/service.ts): due on the report date plus 7 days, assigned
 *   to the student's mentor, note "Meet the student about the AI report of <date>",
 *   shared with the family (they see its date only). An approval creates nothing new
 *   when the case already has its check-in; it adds one only for a case that reached
 *   the gate before this rule (due the same way).
 * - The mentor meets the student within 7 days and submits the conversation
 *   (`record-meeting`, experience-commands.ts) within 14 days. Day 7: the student's
 *   card on the mentor's Today turns to "Meet by now" on its own. After day 14 without a
 *   submitted conversation the department head sees it flagged and decides whether to
 *   message the mentor (staff-messages.ts). Nothing is sent automatically.
 * - The deadline is derived, not stored: the report date (the case's opened_at as a
 *   college date) plus 14 days.
 * - Cases that reached the gate before this rule get their check-in from the backfill
 *   (scripts/backfill-meeting-checkins.ts), due on their report date plus 7 days.
 * - Frozen records (chapter11/frozen.ts) are left out everywhere.
 *
 * Dates are calendar days in the college's time zone (India), so a report at 00:30 IST
 * counts on that day even though the server clock is still on the day before.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ConflictError } from "./http";
import { loadCoreConfig } from "./config";
import { awaitingCases } from "./chapter11/awaiting";
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
/** Meet the student within this many days of the AI report. */
export const MEET_WITHIN_DAYS = 7;
/** Submit the conversation within this many days of the AI report. */
export const SUBMIT_WITHIN_DAYS = 14;
export const COLLEGE_TIME_ZONE = "Asia/Kolkata";
/** Every check-in note created for a report starts with this (the family never sees the note). */
export const REPORT_NOTE_PREFIX = "Meet the student about the AI report of ";

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

/** "15 Oct 2026" */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** The check-in's note: "Meet the student about the AI report of 15 Oct 2026". */
export function reportCheckinNote(reportOn: string): string {
  return `${REPORT_NOTE_PREFIX}${dayLabel(reportOn)}`;
}

/** Meet the student by this day: the report date plus 7 days (the check-in's due date). */
export function meetByDate(reportOn: string): string {
  return addDays(reportOn, MEET_WITHIN_DAYS);
}

/** Submit the conversation by this day: the report date plus 14 days. */
export function deadlineDate(reportOn: string): string {
  return addDays(reportOn, SUBMIT_WITHIN_DAYS);
}

/** The check-in's outcome once the meeting is recorded: "Met on 15 Oct 2026". */
export function meetingOutcome(metOn: string): string {
  return `Met on ${dayLabel(metOn)}`;
}

/**
 * Where a conversation stands, `today` days after the report:
 * - "due": before day 7 (`daysLeft` days until the meet-by day);
 * - "meet_now": days 7 to 14, "Meet by now" (`daysOverdue` past the meet-by day);
 * - "past_deadline": after day 14 without a submitted conversation; the department
 *   head sees it and can message the mentor;
 * - "met": the conversation is submitted.
 */
export type MeetingStage = "due" | "meet_now" | "past_deadline" | "met";
export type MeetingTimeline = {
  report_on: string;
  meet_by: string;
  deadline: string;
  /** Whole days since the report (0 on the report day). */
  days_since: number;
  stage: MeetingStage;
  /** Days left until the meet-by day while "due", else null. */
  days_left: number | null;
  /** Days past the meet-by day once "meet_now" or "past_deadline", else null. */
  days_overdue: number | null;
};
export function meetingTimeline(reportOn: string, today: string, met: boolean): MeetingTimeline {
  const daysSince = daysBetween(reportOn, today);
  const stage: MeetingStage = met
    ? "met"
    : daysSince < MEET_WITHIN_DAYS
      ? "due"
      : daysSince <= SUBMIT_WITHIN_DAYS
        ? "meet_now"
        : "past_deadline";
  return {
    report_on: reportOn,
    meet_by: meetByDate(reportOn),
    deadline: deadlineDate(reportOn),
    days_since: daysSince,
    stage,
    days_left: stage === "due" ? MEET_WITHIN_DAYS - daysSince : null,
    days_overdue: stage === "meet_now" || stage === "past_deadline" ? daysSince - MEET_WITHIN_DAYS : null,
  };
}

export type MeetingInput = {
  metOn: string;
  reasons: string[];
  note?: string;
  agreedNextStep?: string;
};

/**
 * Checks a meeting record and returns it tidied: the day they met is a real date, not
 * in the future and not before the AI report; at least one reason from the fixed list
 * (kept in the list's order, each once); a note when the reason is "Other". Each
 * refusal is a plain sentence the form shows as it is.
 */
export function validateMeeting(
  input: MeetingInput,
  options: { today?: string; reportOn?: string | null } = {},
) {
  const today = options.today ?? collegeDate();
  const metOn = String(input.metOn ?? "");
  if (!DAY.test(metOn) || Number.isNaN(Date.parse(`${metOn}T00:00:00Z`)) || new Date(`${metOn}T00:00:00Z`).toISOString().slice(0, 10) !== metOn)
    throw new ConflictError("MEETING_DATE_INVALID", "Enter the date you met the student.");
  if (metOn > today)
    throw new ConflictError("MEETING_DATE_IN_FUTURE", "The meeting date cannot be in the future.");
  if (options.reportOn && metOn < options.reportOn)
    throw new ConflictError(
      "MEETING_BEFORE_REPORT",
      `The meeting date is before the AI report of ${dayLabel(options.reportOn)}.`,
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

/** Which meeting migrations have run: 014 (support_meetings) and 015 (the case links). */
export type MeetingSchema = { meetings: boolean; timeline: boolean };
// Only a fully positive answer is remembered, so the records appear as soon as the
// migrations have run.
const ready = new Set<string>();
export async function meetingSchema(client: PoolClient): Promise<MeetingSchema> {
  const schema = loadCoreConfig().databaseSchema;
  if (ready.has(schema)) return { meetings: true, timeline: true };
  const row = (
    await client.query<MeetingSchema>(
      `SELECT to_regclass('support_meetings') IS NOT NULL AS meetings,
         EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
           AND table_name='support_followups' AND column_name='support_case_id') AS timeline`,
    )
  ).rows[0] ?? { meetings: false, timeline: false };
  if (row.meetings && row.timeline) ready.add(schema);
  return { meetings: !!row.meetings, timeline: !!row.timeline };
}
/** Meeting records can be written: migrations 014 and 015 have run. */
export async function meetingTablesPresent(client: PoolClient): Promise<boolean> {
  const schema = await meetingSchema(client);
  return schema.meetings && schema.timeline;
}
export const MEETINGS_NOT_READY =
  "Meeting records are not switched on yet: the database update (migrations 014 and 015) has not run.";

/** SQL: the check-ins of the case `caseSql` (linked to the case, or to its plan before migration 015). */
function caseCheckinsSql(timeline: boolean, caseSql: string) {
  return `(${timeline ? `f.support_case_id=${caseSql} OR ` : ""}f.support_plan_id IN (SELECT cp.id FROM support_plans cp WHERE cp.support_case_id=${caseSql}))`;
}

/**
 * The check-in for one AI report, unless the case already has one (never a second per
 * case). Due on the report date plus 7 days, assigned to the student's mentor
 * (`fallbackMentorId` when the student has none), shared with the family, recorded in
 * record_changes under `actorPersonId`. Frozen students get none. Before migration 015
 * a check-in can only be linked to a plan, so without `planId` nothing is created then.
 */
export async function ensureCaseCheckin(
  client: PoolClient,
  input: {
    generation: string;
    caseId: string;
    studentId: string;
    reportOn: string;
    planId?: string | null;
    fallbackMentorId: string;
    actorPersonId: string;
    reason: string;
  },
): Promise<{ created: boolean; id: string | null; dueOn: string | null; mentorPersonId: string | null }> {
  const none = { created: false, id: null, dueOn: null, mentorPersonId: null };
  if ((await frozenStudentIds(client, [input.studentId])).size) return none;
  const { timeline } = await meetingSchema(client);
  const existing = await client.query<{ id: string; due_on: string; mentor_person_id: string }>(
    `SELECT f.id,f.due_on::text AS due_on,f.mentor_person_id FROM support_followups f
     WHERE f.generation_id=$1 AND ${caseCheckinsSql(timeline, "$2::uuid")}
     ORDER BY (f.status<>'completed') DESC,f.due_on LIMIT 1`,
    [input.generation, input.caseId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0]!;
    return { created: false, id: row.id, dueOn: row.due_on, mentorPersonId: row.mentor_person_id };
  }
  if (!timeline && !input.planId) return none;
  const mentor =
    (
      await client.query<{ faculty_person_id: string }>(
        "SELECT faculty_person_id FROM mentor_assignments WHERE generation_id=$1 AND student_id=$2",
        [input.generation, input.studentId],
      )
    ).rows[0]?.faculty_person_id ?? input.fallbackMentorId;
  const id = randomUUID();
  const dueOn = meetByDate(input.reportOn);
  const note = reportCheckinNote(input.reportOn);
  const row = {
    id,
    student_id: input.studentId,
    support_case_id: timeline ? input.caseId : null,
    support_plan_id: input.planId ?? null,
    mentor_person_id: mentor,
    due_on: dueOn,
    note,
    shared: true,
    status: "planned",
    outcome: "",
  };
  if (timeline)
    await client.query(
      "INSERT INTO support_followups(id,generation_id,student_id,support_case_id,support_plan_id,mentor_person_id,due_on,note,shared,status,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'planned','')",
      [id, input.generation, input.studentId, input.caseId, input.planId ?? null, mentor, dueOn, note],
    );
  else
    await client.query(
      "INSERT INTO support_followups(id,generation_id,student_id,support_plan_id,mentor_person_id,due_on,note,shared,status,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,true,'planned','')",
      [id, input.generation, input.studentId, input.planId, mentor, dueOn, note],
    );
  await client.query(
    "INSERT INTO record_changes(id,generation_id,actor_id,resource_type,resource_id,reason,previous,updated) VALUES($1,$2,$3,'support_followups',$4,$5,NULL,$6::jsonb)",
    [randomUUID(), input.generation, input.actorPersonId, id, input.reason, JSON.stringify(row)],
  );
  return { created: true, id, dueOn, mentorPersonId: mentor };
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
export type CaseMeetingFacts = MeetingTimeline & {
  /** The newest meeting recorded for the case (or its plan), or null. */
  meeting: MeetingRecord | null;
  /** The case's open check-in (else its latest), or null when it has none. */
  checkin: { id: string; due_on: string; status: string } | null;
};

/** Timeline, check-in and meeting for each case (no access check: callers pass cases they may read). */
export async function caseMeetingFacts(
  client: PoolClient,
  generation: string,
  caseIds: string[],
  today: string = collegeDate(),
): Promise<Map<string, CaseMeetingFacts>> {
  const facts = new Map<string, CaseMeetingFacts>();
  if (!caseIds.length) return facts;
  const schema = await meetingSchema(client);
  const base = await client.query<{
    case_id: string;
    opened_at: Date;
    checkin_id: string | null;
    checkin_due_on: string | null;
    checkin_status: string | null;
  }>(
    `SELECT c.id AS case_id,c.opened_at,f.id AS checkin_id,f.due_on::text AS checkin_due_on,f.status AS checkin_status
     FROM support_cases c
     LEFT JOIN LATERAL (SELECT f.id,f.due_on,f.status FROM support_followups f WHERE f.generation_id=c.generation_id AND ${caseCheckinsSql(schema.timeline, "c.id")}
       ORDER BY (f.status<>'completed') DESC,f.due_on DESC LIMIT 1) f ON true
     WHERE c.generation_id=$1 AND c.id=ANY($2::uuid[])`,
    [generation, caseIds],
  );
  const meetings = new Map<string, MeetingRecord>();
  if (schema.meetings) {
    const key = schema.timeline ? "COALESCE(m.support_case_id,mp.support_case_id)" : "mp.support_case_id";
    const rows = await client.query<MeetingRecord & { case_id: string }>(
      `SELECT DISTINCT ON (${key}) ${key} AS case_id,m.id,m.followup_id,m.met_on::text AS met_on,m.reasons,m.note,m.agreed_next_step,
         r.display_name AS recorded_by,m.recorded_at
       FROM support_meetings m JOIN people r ON r.id=m.recorded_by LEFT JOIN support_plans mp ON mp.id=m.support_plan_id
       WHERE m.generation_id=$1 AND ${key}=ANY($2::uuid[]) ORDER BY ${key},m.met_on DESC,m.recorded_at DESC`,
      [generation, caseIds],
    );
    for (const row of rows.rows) {
      const { case_id, ...meeting } = row;
      meetings.set(case_id, meeting);
    }
  }
  for (const row of base.rows) {
    const meeting = meetings.get(row.case_id) ?? null;
    facts.set(row.case_id, {
      ...meetingTimeline(collegeDate(row.opened_at), today, !!meeting),
      meeting,
      checkin: row.checkin_id ? { id: row.checkin_id, due_on: row.checkin_due_on!, status: row.checkin_status! } : null,
    });
  }
  return facts;
}

/** caseMeetingFacts keyed by plan id, for plans the caller may read. */
export async function planMeetingFacts(
  client: PoolClient,
  generation: string,
  planIds: string[],
  today: string = collegeDate(),
): Promise<Map<string, CaseMeetingFacts>> {
  const byPlan = new Map<string, CaseMeetingFacts>();
  if (!planIds.length) return byPlan;
  const plans = await client.query<{ id: string; case_id: string }>(
    "SELECT id,support_case_id AS case_id FROM support_plans WHERE generation_id=$1 AND id=ANY($2::uuid[])",
    [generation, planIds],
  );
  const facts = await caseMeetingFacts(client, generation, plans.rows.map((row) => row.case_id), today);
  for (const row of plans.rows) {
    const fact = facts.get(row.case_id);
    if (fact) byPlan.set(row.id, fact);
  }
  return byPlan;
}

/** The shape the screens use for a plan's meeting (staff only). */
export function planMeetingFields(fact: CaseMeetingFacts | undefined): {
  meeting: MeetingRecord | null;
  meeting_due: MeetingTimeline | null;
} {
  if (!fact) return { meeting: null, meeting_due: null };
  return {
    meeting: fact.meeting,
    meeting_due: {
      report_on: fact.report_on,
      meet_by: fact.meet_by,
      deadline: fact.deadline,
      days_since: fact.days_since,
      stage: fact.stage,
      days_left: fact.days_left,
      days_overdue: fact.days_overdue,
    },
  };
}

export type MeetingStatusRow = CaseMeetingFacts & {
  case_id: string;
  /** The case's approved plan, or null while the draft is at the gate. */
  plan_id: string | null;
  case_status: "awaiting_faculty" | "approved";
  student_id: string;
  student_name: string;
  register_number: string;
  mentor_id: string | null;
  mentor_name: string | null;
};

type Scope = { role: string; personId: string; departmentId?: string | null } | "all";
const NO_PERSON = "00000000-0000-0000-0000-000000000000";

/**
 * Each student's current AI report: the newest of the draft at the gate (the gate's own
 * rule, chapter11/awaiting.ts) and the case of the approved current plan (the newest plan
 * shown to the family and on the current figures). Frozen students are left out.
 */
async function trackedCases(client: PoolClient, generation: string, scope: Scope) {
  // "all" reads every department, as the AI activity scope does (awaiting.ts).
  const actor = scope === "all" ? { role: "governance", personId: NO_PERSON, departmentId: null } : scope;
  const gate = (await awaitingCases(client, generation, actor as Parameters<typeof awaitingCases>[2])).map((group) => ({
    case_id: group.current.case_id,
    student_id: group.current.student_id,
    opened_at: new Date(group.current.opened_at),
    plan_id: null as string | null,
    case_status: "awaiting_faculty" as const,
  }));
  const clock = await loadGenerationClock(client);
  const plans = await client.query<{
    plan_id: string;
    case_id: string;
    student_id: string;
    opened_at: Date;
    evidence_captured_at: Date | null;
  }>(
    `SELECT p.id AS plan_id,c.id AS case_id,p.student_id,c.opened_at,${caseEvidenceCapturedSql("p.support_case_id")} AS evidence_captured_at
     FROM support_plans p JOIN support_cases c ON c.id=p.support_case_id
     JOIN faculty_decisions d ON d.id=p.faculty_decision_id AND d.decision='approved'
     JOIN student_profiles s ON s.id=p.student_id
     WHERE p.generation_id=$1 AND p.visible_to_student
       AND ($2::text='all' OR ($2::text='hod' AND s.department_id=$3::uuid)
         OR ($2::text='faculty' AND EXISTS(SELECT 1 FROM mentor_assignments m WHERE m.generation_id=p.generation_id AND m.student_id=p.student_id AND m.faculty_person_id=$4::uuid)))
     ORDER BY p.created_at DESC`,
    [generation, scope === "all" ? "all" : scope.role, scope === "all" ? null : (scope.departmentId ?? null), scope === "all" ? null : scope.personId],
  );
  const seen = new Set<string>();
  const approved = plans.rows
    .filter((row) => {
      if (seen.has(row.student_id) || !isCurrentEvidence(clock, row.evidence_captured_at)) return false;
      seen.add(row.student_id);
      return true;
    })
    .map((row) => ({
      case_id: row.case_id,
      student_id: row.student_id,
      opened_at: new Date(row.opened_at),
      plan_id: row.plan_id as string | null,
      case_status: "approved" as const,
    }));
  const newest = new Map<string, (typeof gate)[number] | (typeof approved)[number]>();
  for (const row of [...gate, ...approved]) {
    const held = newest.get(row.student_id);
    if (!held || row.opened_at.getTime() > held.opened_at.getTime()) newest.set(row.student_id, row);
  }
  const frozen = await frozenStudentIds(client, [...newest.keys()]);
  return [...newest.values()].filter((row) => !frozen.has(row.student_id));
}

/** Most urgent first: the oldest report without a conversation; submitted ones last. */
export function byUrgency(a: { stage: MeetingStage; days_since: number; student_name: string }, b: typeof a) {
  return (
    Number(a.stage === "met") - Number(b.stage === "met") ||
    b.days_since - a.days_since ||
    a.student_name.localeCompare(b.student_name)
  );
}

/**
 * Each student's current AI report and the conversation about it: submitted, or where it
 * stands (due, meet by now, past the deadline). Scope: a mentor's own mentees, or the
 * department head's department. `studentId` narrows it to one student.
 */
export async function meetingStatus(
  client: PoolClient,
  generation: string,
  actor: { role: string; personId: string; departmentId?: string | null },
  today: string = collegeDate(),
  studentId?: string,
): Promise<MeetingStatusRow[]> {
  if (actor.role !== "faculty" && actor.role !== "hod") return [];
  const tracked = (await trackedCases(client, generation, actor)).filter(
    (row) => !studentId || row.student_id === studentId,
  );
  if (!tracked.length) return [];
  const people = await client.query<{
    student_id: string;
    student_name: string;
    register_number: string;
    mentor_id: string | null;
    mentor_name: string | null;
  }>(
    `SELECT s.id AS student_id,sp.display_name AS student_name,s.register_number,m.faculty_person_id AS mentor_id,mp.display_name AS mentor_name
     FROM student_profiles s JOIN people sp ON sp.id=s.person_id
     LEFT JOIN mentor_assignments m ON m.generation_id=s.generation_id AND m.student_id=s.id
     LEFT JOIN people mp ON mp.id=m.faculty_person_id
     WHERE s.generation_id=$1 AND s.id=ANY($2::uuid[])`,
    [generation, tracked.map((row) => row.student_id)],
  );
  const person = new Map(people.rows.map((row) => [row.student_id, row]));
  const facts = await caseMeetingFacts(client, generation, tracked.map((row) => row.case_id), today);
  return tracked
    .flatMap((row) => {
      const who = person.get(row.student_id);
      const fact = facts.get(row.case_id);
      if (!who || !fact) return [];
      return [{ ...fact, case_id: row.case_id, plan_id: row.plan_id, case_status: row.case_status, ...who }];
    })
    .sort(byUrgency);
}

export type MissingCheckin = { caseId: string; planId: string | null; studentId: string; reportOn: string; fallbackMentorId: string | null };

/**
 * Current AI reports that still have no check-in: each student's current case (the draft
 * at the gate or the approved current plan, as the screens track it) with no check-in
 * linked to the case or its plan. Frozen students (student 021) and excluded ones are
 * left out.
 */
export async function loadMissingCheckins(
  client: PoolClient,
  generation: string,
  excludeStudentIds: string[] = [],
): Promise<MissingCheckin[]> {
  const excluded = new Set(excludeStudentIds);
  const tracked = (await trackedCases(client, generation, "all")).filter((row) => !excluded.has(row.student_id));
  if (!tracked.length) return [];
  const facts = await caseMeetingFacts(client, generation, tracked.map((row) => row.case_id));
  const mentors = await client.query<{ student_id: string; mentor_id: string }>(
    "SELECT student_id,faculty_person_id AS mentor_id FROM mentor_assignments WHERE generation_id=$1 AND student_id=ANY($2::uuid[])",
    [generation, tracked.map((row) => row.student_id)],
  );
  const mentorOf = new Map(mentors.rows.map((row) => [row.student_id, row.mentor_id]));
  return tracked
    .filter((row) => !facts.get(row.case_id)?.checkin)
    .map((row) => ({
      caseId: row.case_id,
      planId: row.plan_id,
      studentId: row.student_id,
      reportOn: collegeDate(row.opened_at),
      fallbackMentorId: mentorOf.get(row.student_id) ?? null,
    }));
}

export const BACKFILL_REASON = "Check-in to meet the student about the AI report, added for a report made before this rule";

/** Creates the missing check-ins (due on the report date plus 7 days), recorded under `operatorId`. Counts only. */
export async function applyMissingCheckins(
  client: PoolClient,
  generation: string,
  missing: MissingCheckin[],
  operatorId: string,
  today: string = collegeDate(),
) {
  if (!(await meetingSchema(client)).timeline)
    throw new Error("Run the migrate command first: migration 015 links check-ins to their AI report");
  let created = 0;
  let overdue = 0;
  let skipped = 0;
  for (const report of missing) {
    if (!report.fallbackMentorId) {
      // A student without a mentor has nobody to meet them; the screens say so.
      skipped += 1;
      continue;
    }
    const result = await ensureCaseCheckin(client, {
      generation,
      caseId: report.caseId,
      planId: report.planId,
      studentId: report.studentId,
      reportOn: report.reportOn,
      fallbackMentorId: report.fallbackMentorId,
      actorPersonId: operatorId,
      reason: BACKFILL_REASON,
    });
    if (result.created) {
      created += 1;
      if (meetByDate(report.reportOn) < today) overdue += 1;
    }
  }
  return { created, alreadyOverdue: overdue, withoutMentor: skipped };
}
