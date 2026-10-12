import { requireHostedCollegeEnvironment } from "@aura/contracts";
import type { ActorContext } from "@aura/contracts";
import { withCoreSnapshot } from "./db";
import { getCurrentGeneration } from "./command-ledger";
import { requireExperienceStudent } from "./experience-queries";
import { collegeDatasetHash } from "./chapter11/college-pilot-engine";
import type { CollegeAttendanceReview } from "./chapter11/college-attendance-review";
import { AuthorizationError } from "./security";

/** Project permissions use generated account bindings. No institutional verification is asserted. */
export async function loadProjectSources(actor: ActorContext) {
  if(process.env.CORE_IDENTITY_REALM === "college-project") requireHostedCollegeEnvironment();
  else if(process.env.AURA_LOCAL_PROJECT!=="1" || process.env.CORE_IDENTITY_REALM!=="project")throw new AuthorizationError("Private project mode required");
  return withCoreSnapshot(async c=>{
    const generation=await getCurrentGeneration(c);
    const stored=(await c.query<{review:CollegeAttendanceReview;dataset_hash:string}>("SELECT review,dataset_hash FROM project_dataset WHERE id=$1",[generation])).rows[0];
    if(!stored || collegeDatasetHash(stored.review)!==stored.dataset_hash)throw new Error("Project source integrity check failed");
    if(actor.role==="governance")return {datasetHash:stored.dataset_hash,actorRole:actor.role,privacy:"authenticated_aggregate",students:[],sources:[],counts:{students:stored.review.students.length,sources:stored.review.sources.length},unknowns:["original reporting periods","original source meanings"],riskScore:null,studentSupportPublicationAllowed:false};
    let ids:string[]=[];
    if(actor.role==="student")ids=actor.studentId?[actor.studentId]:[];
    else if(actor.role==="parent")ids=(await c.query<{student_id:string}>("SELECT student_id FROM parent_links WHERE generation_id=$1 AND parent_person_id=$2 AND active",[generation,actor.personId])).rows.map(r=>r.student_id);
    else if(actor.role==="faculty")ids=(await c.query<{student_id:string}>("SELECT s.id AS student_id FROM student_profiles s JOIN mentor_assignments m ON m.student_id=s.id AND m.generation_id=s.generation_id WHERE s.generation_id=$1 AND m.faculty_person_id=$2",[generation,actor.personId])).rows.map(r=>r.student_id);
    else if(actor.role==="hod")ids=(await c.query<{id:string}>("SELECT id FROM student_profiles WHERE generation_id=$1 AND department_id=$2",[generation,actor.departmentId])).rows.map(r=>r.id);
    const selected=[];
    for(const s of stored.review.students.filter(s=>ids.includes(s.id))){
      // Staff IDs were authorized in one query within this read snapshot.
      const grants=actor.role==="faculty" || actor.role==="hod" ? ["attendance","marks"] : (await requireExperienceStudent(c,generation,actor,s.id)).grants;
      if(actor.role==="parent" && !grants.includes("attendance") && !grants.includes("marks"))continue;
      const reports=s.reports.map(r=>({sourceId:r.sourceId,semester:r.semester,section:r.section,cells:r.courses.filter(cell=>actor.role!=="parent" || (cell.field.startsWith("CIE")?grants.includes("marks"):grants.includes("attendance"))).map(cell=>({course:cell.course,field:cell.field,rawValue:cell.value,sourceCell:cell.cell}))})).filter(r=>actor.role!=="parent" || r.cells.length>0);
      if(actor.role!=="parent" || reports.length)selected.push({id:s.id,name:s.name,srn:s.srn,reports});
    }
    const used=new Set(selected.flatMap(s=>s.reports.map(r=>r.sourceId)));
    return {datasetHash:stored.dataset_hash,actorRole:actor.role,privacy:"authenticated_scoped",students:selected,sources:stored.review.sources.filter(s=>used.has(s.id)).map(s=>({id:s.id,filename:s.filename,sheet:s.sheet??"Full_Attendance"})),counts:{students:selected.length,sources:used.size},unknowns:["original reporting periods","original source meanings"],riskScore:null,studentSupportPublicationAllowed:false};
  });
}
