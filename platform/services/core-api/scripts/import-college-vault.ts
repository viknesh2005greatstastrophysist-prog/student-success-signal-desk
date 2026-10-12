import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCollegeAttendanceReview, readPrivateImportFile } from "../lib/chapter11/college-attendance-review";
import { collegeDatasetHash } from "../lib/chapter11/college-pilot-engine";
import { verifyPrivateOriginals } from "../lib/chapter11/college-pilot-sources";
import { validateCollegeAccess, collegeAccessSchema } from "../lib/college-access";
import { digest } from "../lib/chapter11/engine";
import { loadCoreConfig, quoteIdentifier } from "../lib/config";
import { getPool, closePool } from "../lib/db";
process.umask(0o077);
const input = process.argv[2], mapping = process.argv[3];
if (!input || !mapping) throw new Error("Pass private attendance.json and the completed access mapping. Default is validation only; --apply is explicit.");
const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../runtime/college-attendance"));
const folder = await realpath(dirname(input)), location = relative(root, folder);
if (location.startsWith("..") || isAbsolute(location)) throw new Error("Private import directory required");
const review = await loadCollegeAttendanceReview(root, input); await verifyPrivateOriginals(root, folder, review);
const raw = await readPrivateImportFile(root, mapping), parsed = collegeAccessSchema.safeParse(raw);
if (!parsed.success) {
  console.log(JSON.stringify({ readyForVaultImport: false, databaseWritten: false, missingOrInvalidPaths: parsed.error.issues.map(issue => issue.path.join(".")), authorityEvidenceIndependentlyVerified: false }));
  if (process.argv.includes("--apply")) process.exitCode = 1;
} else {
  const datasetHash = collegeDatasetHash(review), access = validateCollegeAccess(raw, review, datasetHash);
  console.log(JSON.stringify({ readyForVaultImport: true, students: review.students.length, mappedAccounts: access.users.length,
    unmappedStudents: review.students.filter(s => !access.users.some(u => u.role === "student" && u.studentIds.includes(s.id))).length,
    authorityEvidenceBasis: "operator-supplied attestation; schema validation does not independently verify institutional approval", databaseWritten: false }));
  if (process.argv.includes("--apply")) {
    const config = loadCoreConfig();
    if (!config.databaseSchema.startsWith("aura_college_") || process.env.CORE_IDENTITY_REALM !== "institutional" || process.env.AURA_IDENTITY_MODE !== "institutional") throw new Error("Apply requires a separate aura_college_* schema and institutional identity mode");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO ${quoteIdentifier(config.databaseSchema)},public`);
      // Require already-provisioned verified accounts. Do not create identities from a spreadsheet row.
      for (const user of access.users) {
        const roles = await client.query(`SELECT r.role,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.generation_id=p.generation_id AND r.active
          JOIN institution_revisions ir ON ir.current_generation_id=p.generation_id WHERE ir.singleton=true AND p.id=$1 AND p.external_subject=$2`, [user.personId, user.subject]);
        if (roles.rowCount !== 1 || roles.rows[0].role !== user.role || (user.departmentId && roles.rows[0].department_id !== user.departmentId)) throw new Error("Institutional account assignment must be provisioned and match the approved mapping before import");
      }
      await client.query(await readFile(new URL("../migrations/college/001_private_vault.sql", import.meta.url), "utf8"));
      const payloadHash = digest({ review, access });
      const packageHash = payloadHash;
      const existing = await client.query("SELECT payload_hash FROM college_source_vault WHERE package_hash=$1", [packageHash]);
      if (existing.rowCount && existing.rows[0].payload_hash !== payloadHash) throw new Error("Existing immutable dataset has different access evidence; use a new reviewed dataset version");
      if (!existing.rowCount) await client.query("INSERT INTO college_source_vault(package_hash,dataset_hash,payload_hash,review,access) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)", [packageHash, datasetHash, payloadHash, JSON.stringify(review), JSON.stringify(access)]);
      await client.query("COMMIT"); console.log(JSON.stringify({ databaseWritten: !existing.rowCount, datasetHash, packageHash, accountBindingsMatched: true }));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await closePool(); }
  }
}
