import { createHash } from "node:crypto";
import type { CollegeAttendanceReview } from "./chapter11/college-attendance-review";
import { collegeDatasetHash } from "./chapter11/college-pilot-engine";

export const projectVersion = "aura.project-cohort.v1";
export function projectKey(seed: string, label: string) {
  const h = createHash("sha256").update(`${projectVersion}:${seed}:${label}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function generateProjectCohort(review: CollegeAttendanceReview, anchor: string) {
  if (!Number.isFinite(Date.parse(anchor))) throw new Error("Valid generation anchor required");
  const seed = collegeDatasetHash(review), key = (label: string) => projectKey(seed, label);
  const generation = key("generation"), department = key("department"), institution = key("institution"), term = key("term");
  const staff = [
    { id: key("hod"), name: "Dr Sahana Krishnan", role: "hod", email: "hod@aura.project.test" },
    { id: key("governance"), name: "Academic Operations", role: "governance", email: "operations@aura.project.test" },
    ...["Dr Mira Sen", "Prof Arjun Rao", "Dr Leena Iyer"].map((name, i) => ({ id: key(`mentor:${i}`), name, role: "faculty", email: `mentor${i+1}@aura.project.test` })),
  ];
  const students = [...review.students].sort((a,b) => a.id.localeCompare(b.id)).map((student, i) => ({
    id: student.id, personId: key(`person:${student.id}`), parentId: key(`parent:${student.id}`), name: student.name, srn: student.srn,
    email: `student${String(i+1).padStart(3,"0")}@aura.project.test`, parentEmail: `parent${String(i+1).padStart(3,"0")}@aura.project.test`,
    parentName: `Family account ${String(i+1).padStart(3,"0")}`, mentorId: staff[2+i%3]!.id,
    semester: Math.max(1,...student.reports.map(r=>r.semester)), cohortYear: new Date(anchor).getUTCFullYear()-Math.floor((Math.max(1,...student.reports.map(r=>r.semester))-1)/2), presentSessions: [4,6,8,9][i%4]!, mark: [48,64,78,92][i%4]!,
    activityDays: [18,6,2,1][i%4]!, missedMilestones: i%4 === 0 ? 1 : 0, missedActivities: i%4 === 1 ? 1 : 0,
    rawCells: student.reports.reduce((n,r)=>n+r.courses.length,0), sourceIds: [...new Set(student.reports.map(r=>r.sourceId))],
  }));
  const courses = [
    ["CS401","Agentic AI and Decision Systems",4], ["CS402","Data Engineering",4], ["CS403","Software Engineering",3],
  ].map(([code,title,credits],i)=>({id:key(`course:${code}`),offeringId:key(`offering:${code}`),code:String(code),title:String(title),credits:Number(credits),facultyId:staff[2+i]!.id,weekday:i+1}));
  const accounts = [...staff, ...students.flatMap(s=>[{id:s.personId,name:s.name,role:"student",email:s.email},{id:s.parentId,name:s.parentName,role:"parent",email:s.parentEmail}])];
  return { version:projectVersion, seed, anchor, generation, department, institution, term, staff, students, courses, accounts,
    provenance:{ supplied:"original names, SRNs and raw report values with source hashes/cells", generated:"accounts, parent links, department, course operations, LMS/career/fee evidence and project policy", sourceDefinitions:"unknown; not inferred", seed } };
}
export type ProjectCohort = ReturnType<typeof generateProjectCohort>;
