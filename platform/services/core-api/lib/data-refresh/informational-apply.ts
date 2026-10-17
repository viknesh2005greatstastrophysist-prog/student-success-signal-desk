/**
 * Backfill of the informational records (spec conformance P2-5) for the CURRENT data
 * generation: LMS quiz scores, internship registration and evaluation, placement
 * readiness, applications and interview outcomes, for every student who has none yet.
 *
 * Deterministic: the values come from `planInformational` with the current data
 * generation's seed, label and as-of time and the figures each student already has.
 * What it never does: create a data generation, change a generation id, an as-of time
 * or an evidence capture time, update or delete any existing row, or write anything
 * for a frozen student (student 021, `chapter11/frozen.ts`) or an excluded one. A
 * student who already has a record is skipped, so a second run writes nothing.
 * The values are informational: no risk signal, threshold or flag reads them, so every
 * stored draft, plan and risk analysis stays as it is and stays current.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { digest } from "../chapter11/engine";
import { frozenStudentIds } from "../chapter11/frozen";
import { getCurrentGeneration } from "../command-ledger";
import { writeInformationalRecords, type InformationalCounts } from "./apply";
import {
  planInformational,
  type InformationalCareer,
  type InformationalInput,
  type InformationalPlan,
} from "./generator";

export const BACKFILL_ORIGIN = "informational_backfill";
export const INFORMATIONAL_TABLES = ["lms_quiz_scores", "internship_records", "placement_records"] as const;

export type BackfillLoad = {
  generation: string;
  dataGeneration: { id: string; label: string; seed: string; asOf: string };
  operatorId: string;
  input: InformationalInput;
  students: number;
  excludedStudents: number;
  /** Students who already have a record, per kind (they are skipped). */
  filled: { quizzes: Set<string>; internship: Set<string>; placement: Set<string> };
};

/** True when migration 013 is applied in this schema. */
export async function informationalTablesReady(c: PoolClient): Promise<boolean> {
  const row = await c.query<{ ready: boolean }>(
    `SELECT ${INFORMATIONAL_TABLES.map((t) => `to_regclass('${t}') IS NOT NULL`).join(" AND ")} AS ready`,
  );
  return !!row.rows[0]?.ready;
}

async function filledStudents(c: PoolClient, generation: string): Promise<BackfillLoad["filled"]> {
  const ids = async (table: string) =>
    new Set((await c.query<{ student_id: string }>(`SELECT DISTINCT student_id FROM ${table} WHERE generation_id=$1`, [generation])).rows.map((r) => r.student_id));
  return { quizzes: await ids("lms_quiz_scores"), internship: await ids("internship_records"), placement: await ids("placement_records") };
}

export async function loadInformationalBackfill(c: PoolClient, opts: { excludeStudentIds: string[] }): Promise<BackfillLoad> {
  if (!(await informationalTablesReady(c)))
    throw new Error("Migration 013 (informational records) is not applied in this schema; run the migrate command first");
  const generation = await getCurrentGeneration(c);
  const current = (await c.query<{ id: string; label: string; seed: string; as_of: Date }>(
    "SELECT id,label,seed,as_of FROM data_generations WHERE generation_id=$1 ORDER BY created_at DESC LIMIT 1",
    [generation],
  )).rows[0];
  if (!current) throw new Error("No data generation is recorded; the backfill fills the current data generation only");
  const operator = (await c.query<{ id: string }>(
    "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='governance' AND r.active ORDER BY p.email LIMIT 1",
    [generation],
  )).rows[0];
  if (!operator) throw new Error("A governance account is required to record the backfill");
  const courses = (await c.query<{ offering_id: string; code: string }>(
    `SELECT o.id AS offering_id,c.code FROM course_offerings o JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id
     WHERE o.generation_id=$1 AND t.active ORDER BY c.code,o.section`,
    [generation],
  )).rows;
  const students = (await c.query<{ id: string; semester: number }>(
    "SELECT id,semester FROM student_profiles WHERE generation_id=$1 ORDER BY register_number",
    [generation],
  )).rows;
  const registrations = (await c.query<{ student_id: string; course_offering_id: string }>(
    `SELECT r.student_id,r.course_offering_id FROM registrations r JOIN course_offerings o ON o.id=r.course_offering_id JOIN terms t ON t.id=o.term_id
     WHERE r.generation_id=$1 AND r.status='registered' AND t.active`,
    [generation],
  )).rows;
  // The course percentage a student already has: the course result, else the mean of the published marks.
  const results = (await c.query<{ student_id: string; course_offering_id: string; pct: number | null }>(
    "SELECT student_id,course_offering_id,percentage::float AS pct FROM course_results WHERE generation_id=$1",
    [generation],
  )).rows;
  const marks = (await c.query<{ student_id: string; course_offering_id: string; pct: number | null }>(
    `SELECT m.student_id,a.course_offering_id,avg(m.score/NULLIF(a.maximum_score,0)*100)::float AS pct
     FROM marks m JOIN assessments a ON a.id=m.assessment_id WHERE m.generation_id=$1 AND a.published GROUP BY 1,2`,
    [generation],
  )).rows;
  const careers = (await c.query<{ student_id: string; source: "internship" | "placement"; state: string | null; missed: string | null }>(
    `SELECT student_id,source,record->>'state' AS state,COALESCE(record->'values'->>'missedMilestones',record->'values'->>'missedActivities') AS missed
     FROM ch11_sources WHERE generation_id=$1 AND source IN ('internship','placement')`,
    [generation],
  )).rows;
  const frozen = await frozenStudentIds(c, students.map((s) => s.id));
  const excluded = new Set([...frozen, ...opts.excludeStudentIds]);

  const offeringsOf = new Map<string, string[]>();
  for (const r of registrations) offeringsOf.set(r.student_id, [...(offeringsOf.get(r.student_id) ?? []), r.course_offering_id]);
  const pctOf = new Map<string, number>();
  for (const m of marks) if (m.pct !== null && Number.isFinite(Number(m.pct))) pctOf.set(`${m.student_id}:${m.course_offering_id}`, Number(m.pct));
  for (const r of results) if (r.pct !== null && Number.isFinite(Number(r.pct))) pctOf.set(`${r.student_id}:${r.course_offering_id}`, Number(r.pct));
  const careerOf = new Map<string, InformationalCareer>();
  for (const x of careers) {
    // A missing record stays missing: no informational record is made up for it.
    if (x.state !== "present" && x.state !== "not_applicable") continue;
    const missed = Number(x.missed ?? 0);
    careerOf.set(`${x.source}:${x.student_id}`, { state: x.state, missed: Number.isFinite(missed) ? missed : 0 });
  }
  const input: InformationalInput = {
    seed: current.seed,
    label: current.label,
    asOf: current.as_of.toISOString(),
    origin: BACKFILL_ORIGIN,
    courses: courses.map((x) => ({ offeringId: x.offering_id, code: x.code })),
    students: students.map((s) => {
      const offerings = offeringsOf.get(s.id) ?? [];
      return {
        studentId: s.id,
        semester: s.semester,
        excluded: excluded.has(s.id),
        offerings,
        coursePct: Object.fromEntries(offerings.map((o) => [o, pctOf.get(`${s.id}:${o}`) ?? null])),
        internship: careerOf.get(`internship:${s.id}`) ?? null,
        placement: careerOf.get(`placement:${s.id}`) ?? null,
      };
    }),
  };
  return {
    generation,
    dataGeneration: { id: current.id, label: current.label, seed: current.seed, asOf: input.asOf },
    operatorId: operator.id,
    input,
    students: students.length,
    excludedStudents: students.filter((s) => excluded.has(s.id)).length,
    filled: await filledStudents(c, generation),
  };
}

/** The plan without the students who already have a record of that kind. Pure. */
export function withoutFilled(plan: InformationalPlan, filled: BackfillLoad["filled"]): InformationalPlan {
  return {
    ...plan,
    quizzes: plan.quizzes.filter((q) => !filled.quizzes.has(q.studentId)),
    internships: plan.internships.filter((i) => !filled.internship.has(i.studentId)),
    placements: plan.placements.filter((p) => !filled.placement.has(p.studentId)),
  };
}

export type BackfillReport = {
  dataGeneration: string;
  asOf: string;
  students: number;
  excludedStudents: number;
  alreadyFilled: { quizScores: number; internshipRecords: number; placementRecords: number };
  toWrite: { quizScores: number; studentsWithQuizScores: number; internshipRecords: number; placementRecords: number };
  written?: InformationalCounts;
  summary: Record<string, unknown>;
};

/** Counts only: never a name, register number or id. */
export function backfillReport(load: BackfillLoad, plan: InformationalPlan): BackfillReport {
  const pending = withoutFilled(plan, load.filled);
  return {
    dataGeneration: load.dataGeneration.label,
    asOf: load.dataGeneration.asOf,
    students: load.students,
    excludedStudents: load.excludedStudents,
    alreadyFilled: { quizScores: load.filled.quizzes.size, internshipRecords: load.filled.internship.size, placementRecords: load.filled.placement.size },
    toWrite: {
      quizScores: pending.quizzes.length,
      studentsWithQuizScores: new Set(pending.quizzes.map((q) => q.studentId)).size,
      internshipRecords: pending.internships.length,
      placementRecords: pending.placements.length,
    },
    summary: plan.summary,
  };
}

/** Writes the pending records in the caller's transaction. Inserts only. */
export async function applyInformationalBackfill(c: PoolClient, load: BackfillLoad): Promise<BackfillReport> {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`informational-backfill:${load.generation}`]);
  // Read who is filled again under the lock, so two runs at once cannot both write.
  const fresh: BackfillLoad = { ...load, filled: await filledStudents(c, load.generation) };
  const plan = planInformational(fresh.input);
  const pending = withoutFilled(plan, fresh.filled);
  const written = await writeInformationalRecords(c, fresh.generation, pending, { mode: "skip" });
  if (written.quizScoresRevised || written.internshipRecordsRevised || written.placementRecordsRevised)
    throw new Error("The backfill never revises an existing row");
  const added = written.quizScoresAdded + written.internshipRecordsAdded + written.placementRecordsAdded;
  if (added) {
    // One append-only audit row, filed under the data generation it fills (not a new generation).
    const detail = { label: fresh.dataGeneration.label, origin: BACKFILL_ORIGIN, scored: false, counts: written, excludedStudents: fresh.excludedStudents };
    await c.query(
      "INSERT INTO ch11_events(id,generation_id,subject_id,actor_person_id,event_type,input_hash,output_hash,detail) VALUES($1,$2,$3,$4,'data.informational.backfilled',$5,$6,$7::jsonb)",
      [
        randomUUID(),
        fresh.generation,
        fresh.dataGeneration.id,
        fresh.operatorId,
        digest({ label: fresh.dataGeneration.label, seed: fresh.dataGeneration.seed, asOf: fresh.dataGeneration.asOf }),
        digest(written),
        JSON.stringify(detail),
      ],
    );
  }
  return { ...backfillReport(fresh, plan), written };
}
