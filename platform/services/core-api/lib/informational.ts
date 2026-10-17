/**
 * Informational records (spec conformance P2-5, lab manual 11.4 agents 2 to 4): LMS quiz
 * scores, internship registration, status and evaluation, placement readiness, application
 * activity and interview outcomes (tables of migration 013).
 *
 * Two readers use them:
 *  - the LMS, internship and placement collectors attach them to the evidence they return
 *    as `informational` (scored: false), next to the scored `values`;
 *  - the student record shows them to the people allowed to see the student: quiz scores
 *    follow the marks grant, internship and placement records the support grant.
 * Nothing here feeds the risk analysis, a threshold or a flag, and the egress guard never
 * sends them to a remote model (it sends `values` metrics only).
 *
 * A database without migration 013 simply has no informational records: every reader
 * checks for the tables first, so the app keeps working before the migration runs.
 */
import type {
  InformationalRecords,
  InternshipRecord,
  PlacementRecord,
  QuizScore,
} from "@aura/contracts";
import type { PoolClient } from "pg";
import { INFORMATIONAL_NOTE, type Informational } from "./chapter11/engine";
import { loadCoreConfig } from "./config";

export const QUIZ_ORIGIN = "LMS quiz log";
export const INTERNSHIP_ORIGIN = "Internship cell register";
export const PLACEMENT_ORIGIN = "Placement cell tracker";

// Schemas where the tables are known to exist. Only a positive answer is remembered,
// so the records appear as soon as the migration has run, without a restart.
const ready = new Set<string>();
export async function informationalTablesPresent(client: PoolClient): Promise<boolean> {
  const schema = loadCoreConfig().databaseSchema;
  if (ready.has(schema)) return true;
  const row = await client.query<{ ok: boolean }>(
    "SELECT to_regclass('lms_quiz_scores') IS NOT NULL AND to_regclass('internship_records') IS NOT NULL AND to_regclass('placement_records') IS NOT NULL AS ok",
  );
  if (row.rows[0]?.ok) ready.add(schema);
  return !!row.rows[0]?.ok;
}

const iso = (value: Date | string | null) =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const num = (value: unknown) => (value == null ? null : Number(value));

/** The student's quiz scores in the active term (one course when given). */
export async function readQuizScores(
  client: PoolClient,
  generation: string,
  studentId: string,
  offeringId: string | null = null,
): Promise<QuizScore[]> {
  if (!(await informationalTablesPresent(client))) return [];
  const rows = await client.query<{ course: string; title: string; score: string; maximum_score: string; taken_at: Date; source: string }>(
    `SELECT c.code AS course,q.quiz_title AS title,q.score::text,q.maximum_score::text,q.taken_at,q.source_label AS source
     FROM lms_quiz_scores q JOIN course_offerings o ON o.id=q.course_offering_id JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id
     WHERE q.generation_id=$1 AND q.student_id=$2 AND t.active AND ($3::uuid IS NULL OR q.course_offering_id=$3::uuid)
     ORDER BY c.code,q.taken_at,q.quiz_title`,
    [generation, studentId, offeringId],
  );
  return rows.rows.map((r) => ({
    course: r.course,
    title: r.title,
    score: Number(r.score),
    maximum_score: Number(r.maximum_score),
    taken_at: iso(r.taken_at)!,
    source: r.source,
  }));
}

export async function readInternshipRecord(
  client: PoolClient,
  generation: string,
  studentId: string,
): Promise<InternshipRecord | null> {
  if (!(await informationalTablesPresent(client))) return null;
  const row = (await client.query<InternshipRecord & { evaluation_score: string | null }>(
    `SELECT status,registered_on::text,organisation,role_title,evaluation_grade,evaluation_score::text,evaluated_on::text,source_label AS source,recorded_on::text
     FROM internship_records WHERE generation_id=$1 AND student_id=$2`,
    [generation, studentId],
  )).rows[0];
  return row ? { ...row, evaluation_score: num(row.evaluation_score) } : null;
}

export async function readPlacementRecord(
  client: PoolClient,
  generation: string,
  studentId: string,
): Promise<PlacementRecord | null> {
  if (!(await informationalTablesPresent(client))) return null;
  return (await client.query<PlacementRecord>(
    `SELECT readiness_score,readiness_as_of::text,applications,last_applied_on::text,interviews,offers,last_outcome,outcome_on::text,source_label AS source,recorded_on::text
     FROM placement_records WHERE generation_id=$1 AND student_id=$2`,
    [generation, studentId],
  )).rows[0] ?? null;
}

const informational = (origin: string, recordedOn: string | null, fields: Informational["fields"], items: Informational["items"] = []): Informational => ({
  scored: false,
  note: INFORMATIONAL_NOTE,
  origin,
  recordedOn,
  fields,
  items,
});

/** The LMS agent's quiz scores as informational evidence (scores and times only). */
export function quizInformational(rows: QuizScore[]): Informational {
  const latest = rows.reduce<string | null>((at, r) => (!at || r.taken_at > at ? r.taken_at : at), null);
  return informational(
    QUIZ_ORIGIN,
    latest ? latest.slice(0, 10) : null,
    { quizzesRecorded: rows.length },
    rows.slice(-60).map((r) => ({ course: r.course, title: r.title, score: r.score, maximum: r.maximum_score, takenAt: r.taken_at })),
  );
}
export function internshipInformational(row: InternshipRecord): Informational {
  return informational(row.source || INTERNSHIP_ORIGIN, row.recorded_on, {
    status: row.status,
    registeredOn: row.registered_on,
    organisation: row.organisation,
    roleTitle: row.role_title,
    evaluationGrade: row.evaluation_grade,
    evaluationScore: row.evaluation_score,
    evaluatedOn: row.evaluated_on,
  });
}
export function placementInformational(row: PlacementRecord): Informational {
  return informational(row.source || PLACEMENT_ORIGIN, row.recorded_on, {
    readinessScore: row.readiness_score,
    readinessAsOf: row.readiness_as_of,
    applications: row.applications,
    lastAppliedOn: row.last_applied_on,
    interviews: row.interviews,
    offers: row.offers,
    lastOutcome: row.last_outcome,
    outcomeOn: row.outcome_on,
  });
}

/** Informational evidence for one collector, or undefined when there is nothing to add
 * (no migration yet, or no internship or placement record for this student). */
export async function sourceInformational(
  client: PoolClient,
  generation: string,
  studentId: string,
  source: "lms" | "internship" | "placement",
): Promise<Informational | undefined> {
  if (!(await informationalTablesPresent(client))) return undefined;
  if (source === "lms") return quizInformational(await readQuizScores(client, generation, studentId));
  if (source === "internship") {
    const row = await readInternshipRecord(client, generation, studentId);
    return row ? internshipInformational(row) : undefined;
  }
  const row = await readPlacementRecord(client, generation, studentId);
  return row ? placementInformational(row) : undefined;
}

/** What the student record shows, within the account's grants. */
export async function experienceInformational(
  client: PoolClient,
  generation: string,
  studentId: string,
  grants: string[],
): Promise<InformationalRecords> {
  const quizzesShared = grants.includes("marks");
  const careerShared = grants.includes("support");
  return {
    scored: false,
    note: INFORMATIONAL_NOTE,
    quizzes: quizzesShared ? await readQuizScores(client, generation, studentId) : null,
    career_shared: careerShared,
    internship: careerShared ? await readInternshipRecord(client, generation, studentId) : null,
    placement: careerShared ? await readPlacementRecord(client, generation, studentId) : null,
  };
}

/** Internship organisations of the given students: the egress guard refuses any payload
 * that names one (a second layer; no payload builder includes them). */
export async function informationalPhrases(
  client: PoolClient,
  generation: string,
  studentIds: string[],
): Promise<string[]> {
  if (!studentIds.length || !(await informationalTablesPresent(client))) return [];
  return (await client.query<{ organisation: string }>(
    "SELECT DISTINCT organisation FROM internship_records WHERE generation_id=$1 AND student_id=ANY($2::uuid[]) AND organisation IS NOT NULL",
    [generation, studentIds],
  )).rows.map((r) => r.organisation);
}
