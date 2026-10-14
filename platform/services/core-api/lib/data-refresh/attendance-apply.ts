/**
 * Reads the attendance inputs and applies the realistic-v3 attendance plan.
 *
 * Additive and audited, like the v2 refresh: no row is deleted, `project_dataset`
 * (the supplied college cells) is only read, every revised attendance record keeps
 * its whole previous image in the append-only `record_changes` table, the
 * generation is a row in `data_generations` (the latest row is the current one)
 * and in the command ledger. Evidence snapshots and cases are not touched.
 */
import type { PoolClient } from "pg";
import { getCurrentGeneration, writeCommandLedger } from "../command-ledger";
import { digest } from "../chapter11/engine";
import { bulkInsert, revise } from "./apply";
import { projectId } from "./generator";
import { ANCHOR_FIELD, type AttendanceInput, type AttendancePlan } from "./attendance";

type Q = <T extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
const q = (c: PoolClient): Q => async (sql, params) => (await c.query(sql, params)).rows as never;

/** Mean of each student's numeric "Recorded attendance" cells within 0 to 100 (null when there are none). */
export async function loadAnchors(c: PoolClient, generation: string): Promise<Map<string, { anchor: number | null; cells: number; outOfRange: number }>> {
  const rows = await q(c)<{ student_id: string; anchor: string | null; cells: string; out_of_range: string }>(
    `SELECT sid AS student_id,
       avg(val) FILTER (WHERE val BETWEEN 0 AND 100)::text AS anchor,
       count(*) FILTER (WHERE val BETWEEN 0 AND 100)::text AS cells,
       count(*) FILTER (WHERE val IS NOT NULL AND val NOT BETWEEN 0 AND 100)::text AS out_of_range
     FROM (SELECT st->>'id' AS sid,
             CASE WHEN c->>'kind'='number' AND jsonb_typeof(c->'value')='number' THEN (c->>'value')::numeric END AS val
           FROM project_dataset d, jsonb_array_elements(d.review->'students') st,
                jsonb_array_elements(st->'reports') r, jsonb_array_elements(r->'courses') c
           WHERE d.id=$1 AND lower(c->>'field')=$2) x
     GROUP BY sid`,
    [generation, ANCHOR_FIELD],
  );
  return new Map(rows.map((r) => [r.student_id, { anchor: r.anchor === null ? null : Number(r.anchor), cells: Number(r.cells), outOfRange: Number(r.out_of_range) }]));
}

export async function loadAttendanceInput(
  c: PoolClient,
  opts: { asOf: string; label: string; seed: string; excludeStudentIds: string[] },
): Promise<AttendanceInput & { generation: string; operatorId: string }> {
  const query = q(c);
  const gen = await getCurrentGeneration(c);
  const done = await c.query("SELECT 1 FROM data_generations WHERE generation_id=$1 AND label=$2", [gen, opts.label]);
  if (done.rowCount) throw new Error(`Data generation ${opts.label} is already applied`);
  const [term] = await query<{ id: string }>("SELECT id FROM terms WHERE generation_id=$1 AND code='2026-ODD'", [gen]);
  if (!term) throw new Error("Term 2026-ODD not found");
  const [operator] = await query<{ id: string }>(
    "SELECT p.id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id WHERE p.generation_id=$1 AND r.role='governance' AND r.active ORDER BY p.email LIMIT 1",
    [gen],
  );
  if (!operator) throw new Error("A governance account is required");
  const courses = await query<{ offering_id: string; code: string; faculty_id: string }>(
    `SELECT o.id AS offering_id,c.code,
       (SELECT fa.faculty_person_id FROM faculty_assignments fa WHERE fa.course_offering_id=o.id AND fa.generation_id=$1 ORDER BY fa.faculty_person_id LIMIT 1) AS faculty_id
     FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND o.term_id=$2 ORDER BY c.code`,
    [gen, term.id],
  );
  if (courses.length !== 3 || courses.some((x) => !x.faculty_id)) throw new Error("Expected three offerings, each with a teacher");
  const sessions = await query<{ id: string; offering_id: string; date: string; topic: string }>(
    "SELECT id,course_offering_id AS offering_id,session_date::text AS date,topic FROM attendance_sessions WHERE generation_id=$1 ORDER BY session_date",
    [gen],
  );
  const records = await query<{ id: string; student_id: string; session_id: string; status: string }>(
    "SELECT id,student_id,attendance_session_id AS session_id,status FROM attendance_records WHERE generation_id=$1", [gen]);
  const students = await query<{ id: string; register: string }>(
    "SELECT id,register_number AS register FROM student_profiles WHERE generation_id=$1 ORDER BY register_number", [gen]);
  const anchors = await loadAnchors(c, gen);
  const mine = new Map<string, Record<string, { id: string; status: string }>>();
  for (const r of records) {
    const m = mine.get(r.student_id) ?? {};
    m[r.session_id] = { id: r.id, status: r.status };
    mine.set(r.student_id, m);
  }
  return {
    seed: opts.seed, label: opts.label, asOf: opts.asOf, generation: gen, operatorId: operator.id,
    courses: courses.map((x) => ({
      offeringId: x.offering_id, code: x.code, facultyId: x.faculty_id,
      sessions: sessions.filter((s) => s.offering_id === x.offering_id).map((s) => ({ id: s.id, date: s.date, topic: s.topic })),
    })),
    students: students.map((s) => {
      const a = anchors.get(s.id);
      return {
        studentId: s.id, register: s.register, excluded: opts.excludeStudentIds.includes(s.id),
        anchor: a?.anchor ?? null, anchorCells: a?.cells ?? 0, records: mine.get(s.id) ?? {},
      };
    }),
  };
}

export type AttendanceApplyResult = { label: string; counts: Record<string, number>; summary: Record<string, unknown>; checksum: string };

export async function applyAttendanceRefresh(
  c: PoolClient,
  input: Awaited<ReturnType<typeof loadAttendanceInput>>,
  plan: AttendancePlan,
): Promise<AttendanceApplyResult> {
  const { generation, operatorId } = input;
  const label = plan.label;
  const existing = await c.query("SELECT 1 FROM data_generations WHERE generation_id=$1 AND label=$2", [generation, label]);
  if (existing.rowCount) throw new Error(`Data generation ${label} is already applied`);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`data-refresh:${generation}`]);
  const ctx = { generation, actor: operatorId, reason: `Data refresh ${label}: generated attendance rebuilt from the college attendance report; previous image kept` };
  const counts: Record<string, number> = {};

  await bulkInsert(c, "attendance_sessions",
    [["id", "uuid"], ["generation_id", "uuid"], ["course_offering_id", "uuid"], ["session_date", "date"], ["topic", "text"], ["status", "text"]],
    plan.sessionInserts.map((s) => [s.id, generation, s.offeringId, s.date, s.topic, "submitted"]));
  counts.sessionsAdded = plan.sessionInserts.length;
  await revise(c, ctx, "attendance_records", "attendance_record", [["status", "text"]],
    plan.recordUpdates.map((r) => ({ id: r.id, values: [r.status] })));
  counts.recordsRevised = plan.recordUpdates.length;
  await bulkInsert(c, "attendance_records",
    [["id", "uuid"], ["generation_id", "uuid"], ["attendance_session_id", "uuid"], ["student_id", "uuid"], ["status", "text"], ["recorded_by_person_id", "uuid"], ["recorded_at", "timestamptz"]],
    plan.recordInserts.map((r) => [r.id, generation, r.sessionId, r.studentId, r.status, r.recordedBy, r.recordedAt]));
  counts.recordsAdded = plan.recordInserts.length;

  const checksum = digest({ plan: { label, seed: plan.seed, asOf: plan.asOf, counts } });
  const summary = { ...plan.summary, counts, asOf: plan.asOf, seed: plan.seed, excludedStudents: input.students.filter((s) => s.excluded).length };
  const id = projectId(plan.seed, `${label}:data-generation`);
  await c.query(
    "INSERT INTO data_generations(id,generation_id,label,seed,as_of,supersedes_label,summary,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
    [id, generation, label, plan.seed, plan.asOf, "realistic-v2", JSON.stringify(summary), operatorId],
  );
  await writeCommandLedger(c, {
    generationId: generation, commandId: projectId(plan.seed, `${label}:ledger:apply`), actorPersonId: operatorId,
    aggregateType: "data_generation", aggregateId: id, eventType: "data.generation.activated", action: "data.generation.activate", topic: "data.generation",
    payload: { label, counts, asOf: plan.asOf, checksum }, metadata: { performedBy: "Claude, authorised by the project owner", additiveOnly: true },
  });
  return { label, counts, summary, checksum };
}
