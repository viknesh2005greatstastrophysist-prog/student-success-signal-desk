import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { collegeDatasetHash } from "../lib/chapter11/college-pilot-engine";
process.umask(0o077);
const input = process.argv[2]; if (!input) throw new Error("Pass the private attendance.json");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../runtime/college-attendance"), review = await loadCollegeAttendanceReview(root, input);
const folder = resolve(dirname(await realpath(input)), "intake"); await mkdir(folder, { recursive: true, mode: 0o700 });
const save = async (name: string, value: unknown) => writeFile(resolve(folder, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
const csv = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
const saveCsv = async (name: string, headers: string[], rows: unknown[][] = []) => writeFile(resolve(folder, name), [headers.map(csv).join(","), ...rows.map(row => headers.map((_, index) => csv(row[index])).join(","))].join("\n") + "\n", { mode: 0o600, flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
await save("source-definitions.json", { datasetHash: collegeDatasetHash(review), sources: review.sources.map(source => ({ sourceHash: source.id, filename: source.filename,
  academicYear: null, termCode: null, periodStart: null, periodEnd: null, numericUnit: null, zeroMeaning: null, naMeaning: null, tnsMeaning: null, dashMeaning: null,
  maximumCieMarks: null, eligibilityRules: null, confirmedBy: null, evidenceReference: null })) });
await save("access-mapping.template.json", { schemaVersion: "aura.verified-college-access.v1", datasetHash: collegeDatasetHash(review), dataAccessApproved: null,
  approvedBy: null, approvalReference: null, sourceDepartments: review.sources.map(source => ({ sourceId: source.id, departmentId: null })), users: [] });
await save("approved-policy.json", { version: null, attendanceMinimum: null, markMinimum: null, inactivityMaximum: null, mediumScore: null, highScore: null,
  freshnessDays: null, aggregationRules: null, rationale: null, approvedByMentor: null, approvalReference: null });
await save("normalized-sources.template.json", { schemaVersion: "aura.approved-college-normalization.v1", packageHash: null, academicTerm: null,
  periodStart: null, periodEnd: null, sourceDefinitionsConfirmed: null, mentorApprovals: [], approvalReference: null, normalizationRules: null, records: [] });
await saveCsv("student-accounts-and-mentors.csv", ["imported_student_id", "srn", "recorded_name", "verified_account_email", "oidc_subject", "core_person_id", "department_id", "cohort_year", "current_semester", "mentor_person_id", "identity_verification_reference"], review.students.map(student => [student.id, student.srn, student.name]));
await saveCsv("staff-and-parent-accounts.csv", ["role", "name", "verified_email", "oidc_subject", "core_person_id", "department_id", "linked_student_ids", "verified_relationship", "attendance_grant", "marks_grant", "verification_reference"]);
await saveCsv("course-and-teaching-map.csv", ["source_hash", "source_course_label", "institutional_course_id", "official_title", "credits", "maximum_cie_marks", "department_id", "term_id", "assigned_faculty_id", "mapping_reference"], review.sources.flatMap(source => source.courseColumns.map(label => [source.id, label])));
await saveCsv("lms-activity.csv", ["srn", "course_id", "term_id", "source_record_id", "observed_at", "last_activity_at", "published_assignment_id", "due_at", "submitted_at", "source_reference"]);
await saveCsv("career-evidence.csv", ["srn", "source_internship_or_placement", "state_present_or_not_applicable", "source_record_id", "observed_at", "missed_milestones_or_activities", "confirmed_by", "source_reference"]);
await saveCsv("registrations-and-timetable.csv", ["srn", "term_id", "course_id", "registration_confirmed", "class_day", "start_time", "end_time", "room", "faculty_id", "source_reference"]);
await saveCsv("fee-records-if-in-scope.csv", ["srn", "invoice_number", "description", "amount_due", "currency", "due_date", "paid_amount", "payment_reference", "source_reference"]);
console.log(JSON.stringify({ folder: "intake/", studentsPrefilled: review.students.length, sourceDefinitionsRemainUnknown: true, credentialsRequested: false, overwroteExistingAnswers: false }));
