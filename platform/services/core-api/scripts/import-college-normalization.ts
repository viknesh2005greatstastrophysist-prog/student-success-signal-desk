import { realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizedCollegeBatchSchema } from "../lib/college-normalized";
import { readPrivateImportFile } from "../lib/chapter11/college-attendance-review";
import { digest } from "../lib/chapter11/engine";
import { withCoreTransaction, closePool } from "../lib/db";
import { loadCoreConfig } from "../lib/config";

const input = process.argv[2]; if (!input) throw new Error("Pass a private normalization file; default is check only");
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../runtime/college-attendance"));
const parsed = normalizedCollegeBatchSchema.safeParse(await readPrivateImportFile(root, input));
if (!parsed.success) {
  console.log(JSON.stringify({ normalizationReady: false, databaseWritten: false, invalidPaths: parsed.error.issues.map(issue => issue.path.join(".")) }));
  if (process.argv.includes("--apply")) process.exitCode = 1;
} else {
  const batch = parsed.data, batchHash = digest(batch);
  console.log(JSON.stringify({ normalizationReady: true, records: batch.records.length, batchHash, databaseWritten: false, approvalEvidenceBasis: "operator-supplied attestation plus matched active mentor assignments on apply" }));
  if (process.argv.includes("--apply")) {
    if (!loadCoreConfig().databaseSchema.startsWith("aura_college_") || process.env.CORE_IDENTITY_REALM !== "institutional") throw new Error("Private institutional schema required");
    try {
      await withCoreTransaction(async client => {
        const vault = await client.query("SELECT review FROM college_source_vault WHERE package_hash=$1", [batch.packageHash]);
        if (!vault.rowCount) throw new Error("Source package must be imported first");
        const students = vault.rows[0].review.students as Array<{ id: string }>;
        const assigned = await client.query<{ student_id: string; faculty_person_id: string }>("SELECT m.student_id,m.faculty_person_id FROM mentor_assignments m JOIN role_assignments r ON r.person_id=m.faculty_person_id AND r.generation_id=m.generation_id AND r.role='faculty' AND r.active WHERE m.faculty_person_id=ANY($1::uuid[]) AND m.generation_id=(SELECT current_generation_id FROM institution_revisions WHERE singleton=true)", [batch.mentorApprovals.map(approval => approval.mentorId)]);
        for (const approval of batch.mentorApprovals) if (!students.some(s => s.id === approval.studentId) || !assigned.rows.some(s => s.student_id === approval.studentId && s.faculty_person_id === approval.mentorId)) throw new Error("Each normalization approval must match the student's actual active mentor assignment");
        await client.query("INSERT INTO college_normalization_vault(batch_hash,package_hash,batch) VALUES($1,$2,$3::jsonb) ON CONFLICT(batch_hash) DO NOTHING", [batchHash, batch.packageHash, JSON.stringify(batch)]);
      });
      console.log(JSON.stringify({ databaseWritten: true, batchHash }));
    } finally { await closePool(); }
  }
}
