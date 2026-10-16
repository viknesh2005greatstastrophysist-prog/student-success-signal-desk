import type { PoolClient } from "pg";
import { ToolRefused } from "./agent-loop";
import { retrieve, type Evidence, type Reference } from "./engine";
import type { DomainName } from "./catalogue";
import type { InvestigationBackend } from "./investigator";
import { withCoreTransaction } from "../db";
import { getCurrentGeneration } from "../command-ledger";
import { FALLBACK_TERM_CODE } from "../active-term";

/**
 * Server-side resolution for the investigator tools. The backend is built for
 * exactly one in-scope student of one frozen evidence snapshot:
 *  - `authorize` re-checks the actor's department and mentor assignment on every
 *    call (the same connector authorisation the collectors use);
 *  - rows are bounded by the snapshot's capture time and the active term, and a
 *    tool whose recomputed overall figure no longer matches the frozen snapshot
 *    is refused (EVIDENCE_DRIFT) instead of mixing two states of the data. The
 *    institution revision itself moves on every command, so it cannot be used
 *    as an equality fence;
 * It returns plain numbers by course, week or component. It never returns a
 * name, a register number, a date or a row of another student.
 */
export type BackendDeps = {
  studentId: string;
  generation: string;
  capturedAt: string;
  evidence: Evidence;
  domain: DomainName;
  departmentId: string;
  signalText: string;
  authorize(): Promise<unknown>;
  prior(): Promise<Reference[]>;
};

export const componentSlug = (category: string) =>
  category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 22) || "other";

function numericValues(source: { values?: Record<string, unknown> } | undefined) {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source?.values ?? {}))
    if (/^[A-Za-z]{1,30}$/.test(key) && typeof value === "number" && Number.isFinite(value))
      out[key] = value;
  return out;
}

export function createInvestigationBackend(d: BackendDeps): InvestigationBackend {
  // The term the snapshot was collected for (the active term then, P3-3).
  const term = d.evidence.academic.semester || FALLBACK_TERM_CODE;
  const frozen = async <T>(work?: (client: PoolClient) => Promise<T>) => {
    await d.authorize();
    return withCoreTransaction(async (client) => {
      if ((await getCurrentGeneration(client)) !== d.generation)
        throw new ToolRefused("EVIDENCE_REVISION_CHANGED");
      return work ? work(client) : (undefined as T);
    });
  };
  /** Frozen figures from the snapshot; the live recomputation must agree. */
  const agrees = (live: number, metric: "attendancePct" | "markPct") => {
    const frozen = d.evidence.academic.values[metric];
    if (typeof frozen === "number" && Math.abs(frozen - live) > 0.5)
      throw new ToolRefused("EVIDENCE_DRIFT");
  };
  return {
    attendance: (by) =>
      frozen(async (client) => {
        const grouped =
          by === "course"
            ? "cc.code AS course, NULL::int AS week"
            : "NULL::text AS course, greatest(1,((s.session_date - t.starts_on) / 7 + 1))::int AS week";
        const result = await client.query<{
          course: string | null;
          week: number | null;
          attended: number;
          held: number;
        }>(
          `SELECT ${grouped},
             count(*) FILTER (WHERE r.status IN ('present','late'))::int AS attended,
             count(*)::int AS held
           FROM attendance_records r
           JOIN attendance_sessions s ON s.id=r.attendance_session_id
           JOIN course_offerings co ON co.id=s.course_offering_id
           JOIN courses cc ON cc.id=co.course_id
           JOIN terms t ON t.id=co.term_id
           WHERE t.code=$4 AND t.active AND r.generation_id=$1 AND r.student_id=$2
             AND s.status IN ('submitted','locked') AND r.status<>'excused'
             AND r.recorded_at <= $3::timestamptz
           GROUP BY 1,2 ORDER BY 1,2`,
          [d.generation, d.studentId, d.capturedAt, term],
        );
        const attended = result.rows.reduce((n, r) => n + r.attended, 0);
        const held = result.rows.reduce((n, r) => n + r.held, 0);
        if (held) agrees((attended / held) * 100, "attendancePct");
        return result.rows.map((r) => ({
          ...(r.course ? { course: r.course } : {}),
          ...(r.week !== null ? { week: r.week } : {}),
          attended: r.attended,
          held: r.held,
        }));
      }),
    assessments: (component) =>
      frozen(async (client) => {
        const result = await client.query<{
          category: string;
          score: string;
          maximum_score: string;
        }>(
          `SELECT a.category, m.score, a.maximum_score
           FROM marks m JOIN assessments a ON a.id=m.assessment_id
           JOIN course_offerings co ON co.id=a.course_offering_id
           JOIN terms t ON t.id=co.term_id
           WHERE t.code=$4 AND t.active AND m.generation_id=$1 AND m.student_id=$2
             AND a.published AND a.maximum_score>0 AND m.recorded_at <= $3::timestamptz
           ORDER BY m.recorded_at, a.title`,
          [d.generation, d.studentId, d.capturedAt, term],
        );
        const pct = (r: { score: string; maximum_score: string }) =>
          (Number(r.score) / Number(r.maximum_score)) * 100;
        if (result.rows.length)
          agrees(
            result.rows.reduce((n, r) => n + pct(r), 0) / result.rows.length,
            "markPct",
          );
        if (component)
          return result.rows
            .filter((r) => componentSlug(r.category) === component)
            .slice(0, 8)
            .map((r, i) => ({
              component: `${component}-${i + 1}`,
              markPct: pct(r),
              count: 1,
            }));
        const groups = new Map<string, number[]>();
        for (const r of result.rows) {
          const slug = componentSlug(r.category);
          groups.set(slug, [...(groups.get(slug) ?? []), pct(r)]);
        }
        return [...groups].map(([slug, values]) => ({
          component: slug,
          markPct: values.reduce((a, b) => a + b, 0) / values.length,
          count: values.length,
        }));
      }),
    lmsTimeline: (weeks) =>
      frozen(async (client) => {
        const result = await client.query<{ ago: number; kind: string; n: number }>(
          `SELECT floor(extract(epoch FROM ($3::timestamptz - a.occurred_at))/604800)::int AS ago, a.kind, count(*)::int AS n
           FROM lms_activity a JOIN course_offerings co ON co.id=a.course_offering_id
           JOIN terms t ON t.id=co.term_id
           WHERE a.generation_id=$1 AND a.student_id=$2 AND t.active
             AND a.occurred_at <= $3::timestamptz
             AND a.occurred_at > $3::timestamptz - ($4::int * interval '7 days')
           GROUP BY 1,2`,
          [d.generation, d.studentId, d.capturedAt, weeks],
        );
        return Array.from({ length: weeks }, (_, weeksAgo) => ({
          weeksAgo,
          lessonsOpened: result.rows
            .filter((r) => r.ago === weeksAgo && r.kind === "lesson_opened")
            .reduce((n, r) => n + r.n, 0),
          submissions: result.rows
            .filter((r) => r.ago === weeksAgo && r.kind === "assignment_submitted")
            .reduce((n, r) => n + r.n, 0),
        }));
      }),
    internship: async () => {
      await frozen();
      return numericValues(d.evidence.internship);
    },
    placement: async () => {
      await frozen();
      return numericValues(d.evidence.placement);
    },
    similar: async (k) => {
      await frozen();
      return retrieve(
        d.signalText,
        [d.domain],
        await d.prior(),
        d.departmentId,
        d.studentId,
      ).slice(0, k);
    },
  };
}
