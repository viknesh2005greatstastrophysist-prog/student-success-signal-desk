import type { PoolClient } from "pg";
import { ConflictError } from "../http";

/**
 * Frozen records (review R-03). Some records are kept exactly as they are for
 * the project presentation: student 021's pending support case stays visible,
 * pending and untouched. Reads are unchanged; every write path refuses a frozen
 * record with FROZEN_RECORD and the planner leaves frozen students out.
 *
 * The lists come from CORE_FROZEN_CASE_IDS and CORE_FROZEN_REGISTER_NUMBERS
 * (comma-separated). Unset means the project default below; an empty value
 * freezes nothing. A student is frozen when their register number is listed or
 * when they own a listed support case.
 */
export const DEFAULT_FROZEN_CASE_IDS = ["d398bbc3-60b1-4843-aabc-4d7f1e0d2a3b"];
export const DEFAULT_FROZEN_REGISTER_NUMBERS = ["01FE23BCI103"];

type Env = Record<string, string | undefined>;

function list(value: string | undefined, fallback: string[]) {
  return (value === undefined ? fallback : value.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}
export function frozenCaseIds(env: Env = process.env): string[] {
  return list(env.CORE_FROZEN_CASE_IDS, DEFAULT_FROZEN_CASE_IDS).map((id) => id.toLowerCase());
}
export function frozenRegisterNumbers(env: Env = process.env): string[] {
  return list(env.CORE_FROZEN_REGISTER_NUMBERS, DEFAULT_FROZEN_REGISTER_NUMBERS).map((number) => number.toUpperCase());
}
export function isFrozenCase(caseId: unknown, env: Env = process.env): boolean {
  return typeof caseId === "string" && frozenCaseIds(env).includes(caseId.toLowerCase());
}
export function isFrozenRegisterNumber(registerNumber: unknown, env: Env = process.env): boolean {
  return typeof registerNumber === "string" && frozenRegisterNumbers(env).includes(registerNumber.trim().toUpperCase());
}

export const FROZEN_MESSAGE =
  "This record is kept unchanged for the project presentation. It can be read, but not changed.";
export function frozenRecordError() {
  return new ConflictError("FROZEN_RECORD", FROZEN_MESSAGE);
}
/** Refuses a frozen support case before any database access. */
export function assertCaseNotFrozen(caseId: string, env: Env = process.env) {
  if (isFrozenCase(caseId, env)) throw frozenRecordError();
}
/** One line for a plan or a planning response that left frozen students out. */
export function frozenLeftOutNote(count: number) {
  return `${count} student${count === 1 ? " was" : "s were"} left out: ${count === 1 ? "their record is" : "their records are"} kept unchanged for the project presentation.`;
}

/** The given students that are frozen (listed register number or a listed case). */
export async function frozenStudentIds(
  client: PoolClient,
  studentIds: string[],
  env: Env = process.env,
): Promise<Set<string>> {
  const registers = frozenRegisterNumbers(env);
  const cases = frozenCaseIds(env);
  if (!studentIds.length || (!registers.length && !cases.length)) return new Set();
  const rows = await client.query<{ id: string }>(
    `SELECT s.id FROM student_profiles s WHERE s.id=ANY($1::uuid[])
     AND (upper(s.register_number)=ANY($2::text[]) OR EXISTS(SELECT 1 FROM support_cases c WHERE c.student_id=s.id AND lower(c.id::text)=ANY($3::text[])))`,
    [studentIds, registers, cases],
  );
  return new Set(rows.rows.map((row) => row.id));
}
/** Refuses a write that would change a frozen student's records. */
export async function assertStudentNotFrozen(
  client: PoolClient,
  studentId: string,
  env: Env = process.env,
) {
  if ((await frozenStudentIds(client, [studentId], env)).size) throw frozenRecordError();
}
