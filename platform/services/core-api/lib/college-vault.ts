import type { ActorContext } from "@aura/contracts";
import { withCoreTransaction } from "./db";
import { ConflictError } from "./http";
import { projectCollegeSources } from "./college-access";
import { digest } from "./chapter11/engine";
import type { CollegeAttendanceReview } from "./chapter11/college-attendance-review";

/** Actual source data uses a separately enabled private vault; demo datasets cannot fall through. */
export async function loadAuthenticatedCollegeSources(actor: ActorContext) {
  const packageHash = process.env.COLLEGE_ACTIVE_PACKAGE_HASH;
  if (!packageHash || !/^[a-f0-9]{64}$/.test(packageHash)) throw new ConflictError("COLLEGE_DATA_NOT_ENABLED", "Actual college records are not enabled. Verified account and source mappings are required.");
  if (process.env.CORE_IDENTITY_REALM !== "institutional") throw new ConflictError("INSTITUTIONAL_IDENTITY_REQUIRED", "A separate institutional identity realm is required for actual records.");
  if (!(process.env.CORE_DATABASE_SCHEMA ?? "").startsWith("aura_college_")) throw new ConflictError("PRIVATE_COLLEGE_SCHEMA_REQUIRED", "Actual records require a separate private college database schema.");
  return withCoreTransaction(async client => {
    const result = await client.query<{ dataset_hash: string; review: CollegeAttendanceReview; access: unknown; payload_hash: string }>("SELECT dataset_hash,review,access,payload_hash FROM college_source_vault WHERE package_hash=$1", [packageHash]);
    const row = result.rows[0];
    if (!row) throw new ConflictError("COLLEGE_DATASET_NOT_IMPORTED", "The approved private dataset is not imported.");
    if (digest({ review: row.review, access: row.access }) !== row.payload_hash) throw new ConflictError("COLLEGE_VAULT_INTEGRITY_FAILED", "The stored source package failed integrity verification.");
    let liveScope: { studentIds: string[]; perStudentFields?: Record<string, string[]> } = { studentIds: row.review.students.map(s => s.id) };
    if (actor.role === "student") liveScope = { studentIds: actor.studentId ? [actor.studentId] : [] };
    else if (actor.role === "faculty") {
      const assignments = await client.query<{ student_id: string }>("SELECT student_id FROM mentor_assignments WHERE faculty_person_id=$1 AND generation_id=(SELECT current_generation_id FROM institution_revisions WHERE singleton=true)", [actor.personId]);
      liveScope = { studentIds: assignments.rows.map(r => r.student_id) };
    } else if (actor.role === "parent") {
      const grants = await client.query<{ student_id: string; field_group: string }>(`SELECT link.student_id,g.field_group FROM parent_links link JOIN parent_field_grants g ON g.parent_link_id=link.id AND g.generation_id=link.generation_id
        WHERE link.parent_person_id=$1 AND link.active AND g.granted AND link.generation_id=(SELECT current_generation_id FROM institution_revisions WHERE singleton=true)`, [actor.personId]);
      const perStudentFields: Record<string, string[]> = {};
      for (const grant of grants.rows) (perStudentFields[grant.student_id] ??= []).push(grant.field_group);
      liveScope = { studentIds: Object.keys(perStudentFields), perStudentFields };
    }
    return projectCollegeSources(actor, row.review, row.access, row.dataset_hash, liveScope);
  });
}
