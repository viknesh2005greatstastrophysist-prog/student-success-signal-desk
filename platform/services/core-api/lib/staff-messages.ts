/**
 * Messages from the department head to a mentor (owner decision, 17 Oct). When the
 * conversation with a student about the AI report has not been submitted 14 days after
 * the report (meetings.ts), the department head sees it flagged and can send the mentor
 * a message from inside the app asking why. Nothing is sent automatically.
 *
 * - `send-message` (experience-commands.ts): the department head only, about an AI
 *   report of a student in their department, to that student's mentor (an active mentor
 *   in the department). The message is the standard reminder below plus an optional note.
 * - `mark-message-read`: the recipient only; sets read_at once.
 * - The mentor's Today lists the unread messages; the department head's list of
 *   conversations not submitted shows "Reminder sent <date>" and "Read <date>".
 *
 * Table staff_messages (migration 016). Until it has run, sending is refused with a
 * plain sentence and the screens show no messages.
 */
import type { PoolClient } from "pg";
import type { ActorContext } from "@aura/contracts";
import { ConflictError, NotFoundError } from "./http";
import { loadCoreConfig } from "./config";
import { collegeDate, dayLabel } from "./meetings";

export const STAFF_MESSAGES_NOT_READY =
  "Messages are not switched on yet: the database update (migration 016) has not run.";
export const NOTE_MAX = 1000;

// Schemas where migration 016 is known to be applied (only a positive answer is kept).
const ready = new Set<string>();
export async function staffMessagesPresent(client: PoolClient): Promise<boolean> {
  const schema = loadCoreConfig().databaseSchema;
  if (ready.has(schema)) return true;
  const row = await client.query<{ ok: boolean }>("SELECT to_regclass('staff_messages') IS NOT NULL AS ok");
  if (row.rows[0]?.ok) ready.add(schema);
  return !!row.rows[0]?.ok;
}

/** Names stored in capitals read as "Asha Rao"; mixed-case names are kept (as the screens do). */
export function prettyName(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** The standard reminder the department head sends. */
export function reminderText(studentName: string, reportOn: string): string {
  return (
    `The conversation with ${prettyName(studentName)} about the AI report of ${dayLabel(reportOn)} has not been submitted. ` +
    "Please meet the student and record it, or tell me why not."
  );
}

/** The message as stored: the reminder, then the department head's note when there is one. */
export function messageBody(reminder: string, note: string): string {
  const extra = note.trim();
  return extra ? `${reminder}\n\n${extra}` : reminder;
}

/**
 * Who a reminder about this AI report goes to: the student's mentor, for a report of a
 * student in the department head's department. Refuses a report outside the
 * department (not found) and a student without a mentor.
 */
export async function reminderTarget(
  client: PoolClient,
  generation: string,
  actor: Pick<ActorContext, "departmentId">,
  caseId: string,
) {
  const row = (
    await client.query<{ student_id: string; student_name: string; opened_at: Date; mentor_id: string | null }>(
      `SELECT c.student_id,sp.display_name AS student_name,c.opened_at,m.faculty_person_id AS mentor_id
       FROM support_cases c JOIN student_profiles s ON s.id=c.student_id JOIN people sp ON sp.id=s.person_id
       LEFT JOIN mentor_assignments m ON m.generation_id=c.generation_id AND m.student_id=c.student_id
       WHERE c.generation_id=$1 AND c.id=$2 AND s.department_id=$3::uuid`,
      [generation, caseId, actor.departmentId ?? null],
    )
  ).rows[0];
  if (!row) throw new NotFoundError("AI report not found in your department");
  if (!row.mentor_id) throw new ConflictError("NO_MENTOR", "This student has no mentor to message.");
  const reportOn = collegeDate(row.opened_at);
  return {
    studentId: row.student_id,
    mentorId: row.mentor_id,
    reportOn,
    reminder: reminderText(row.student_name, reportOn),
  };
}

export type StaffMessage = {
  id: string;
  from_name: string;
  to_name: string;
  student_id: string;
  student_name: string;
  support_case_id: string | null;
  body: string;
  sent_at: string;
  read_at: string | null;
};

/** The messages a mentor received, newest first (the 50 most recent). */
export async function receivedMessages(client: PoolClient, generation: string, personId: string): Promise<StaffMessage[]> {
  if (!(await staffMessagesPresent(client))) return [];
  return (
    await client.query<StaffMessage>(
      `SELECT m.id,f.display_name AS from_name,t.display_name AS to_name,m.student_id,sp.display_name AS student_name,
         m.support_case_id,m.body,m.sent_at,m.read_at
       FROM staff_messages m JOIN people f ON f.id=m.from_person_id JOIN people t ON t.id=m.to_person_id
       JOIN student_profiles s ON s.id=m.student_id JOIN people sp ON sp.id=s.person_id
       WHERE m.generation_id=$1 AND m.to_person_id=$2 ORDER BY m.sent_at DESC LIMIT 50`,
      [generation, personId],
    )
  ).rows;
}

export type Reminder = { sent_at: string; read_at: string | null; from_name: string };

/** The latest reminder about each AI report, for reports the caller may read. */
export async function remindersByCase(client: PoolClient, generation: string, caseIds: string[]): Promise<Map<string, Reminder>> {
  const out = new Map<string, Reminder>();
  if (!caseIds.length || !(await staffMessagesPresent(client))) return out;
  const rows = await client.query<Reminder & { case_id: string }>(
    `SELECT DISTINCT ON (m.support_case_id) m.support_case_id AS case_id,m.sent_at,m.read_at,f.display_name AS from_name
     FROM staff_messages m JOIN people f ON f.id=m.from_person_id
     WHERE m.generation_id=$1 AND m.support_case_id=ANY($2::uuid[]) ORDER BY m.support_case_id,m.sent_at DESC`,
    [generation, caseIds],
  );
  for (const row of rows.rows) {
    const { case_id, ...reminder } = row;
    out.set(case_id, reminder);
  }
  return out;
}
