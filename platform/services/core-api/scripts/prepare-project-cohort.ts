import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { verifyPrivateOriginals } from "../lib/chapter11/college-pilot-sources";
import { generateProjectCohort, projectKey } from "../lib/project-cohort";
import { withCoreTransaction, closePool } from "../lib/db";
import { demoBands } from "../lib/experience-seed";
import { sourceSchema } from "../lib/chapter11/engine";
process.umask(0o077);
const root=resolve("../runtime/college-attendance"), input=resolve(process.argv[2]??"../runtime/college-attendance/2026-10-12/attendance.json"), out=resolve("../runtime/project-final");
if(process.env.CORE_IDENTITY_REALM!=="project" || process.env.CORE_DATABASE_SCHEMA!=="aura_project_core" || new URL(process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL??"").hostname!=="127.0.0.1")throw new Error("Private local project database required");
await mkdir(out,{recursive:true,mode:0o700});
const review=await loadCollegeAttendanceReview(root,input);await verifyPrivateOriginals(root,resolve(input,".."),review);
let saved: ReturnType<typeof generateProjectCohort>|undefined;
try{saved=JSON.parse(await readFile(resolve(out,"cohort.json"),"utf8"));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
const cohort=generateProjectCohort(review,saved?.anchor??new Date().toISOString());
if(saved && saved.seed!==cohort.seed)throw new Error("Source dataset changed; preserve the existing project and create a reviewed new version");
const id=(label:string)=>projectKey(cohort.seed,label);
try{await withCoreTransaction(async c=>{
  await c.query("CREATE TABLE IF NOT EXISTS project_dataset(id uuid PRIMARY KEY,dataset_hash text NOT NULL,review jsonb NOT NULL,provenance jsonb NOT NULL)");
  await c.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='project_dataset_immutable' AND tgrelid='project_dataset'::regclass) THEN CREATE TRIGGER project_dataset_immutable BEFORE UPDATE OR DELETE ON project_dataset FOR EACH ROW EXECUTE FUNCTION reject_append_only_change(); END IF; END $$");
  const current=await c.query("SELECT current_generation_id FROM institution_revisions WHERE singleton=true");
  if(current.rowCount){if(current.rows[0].current_generation_id!==cohort.generation)throw new Error("Refusing to overwrite a different generation");console.log("Project cohort already initialized; edits preserved.");return;}
  // Initial load is atomic. Subsequent runs do not reseed or overwrite user edits.
  const insert=async(table:string,records:Record<string,unknown>[])=>{
    if(!records.length)return;const cols=Object.keys(records[0]!);
    for(let start=0;start<records.length;start+=300){const chunk=records.slice(start,start+300),values:unknown[]=[];
      const tuples=chunk.map(row=>"("+cols.map(col=>{values.push(row[col]!==null && typeof row[col]==="object"?JSON.stringify(row[col]):row[col]);return "$"+values.length;}).join(",")+")");
      await c.query(`INSERT INTO ${table}(${cols.join(",")}) VALUES ${tuples.join(",")}`,values);
    }
  };
  const g={generation_id:cohort.generation},hod=cohort.staff[0]!.id;
  await insert("institutions",[{...g,id:cohort.institution,code:"AURA-PROJECT",name:"AURA Academic Institute"}]);
  await insert("departments",[{...g,id:cohort.department,institution_id:cohort.institution,code:"CSE",name:"Computer Science and Engineering"}]);
  await insert("people",cohort.accounts.map(a=>({...g,id:a.id,external_subject:a.id,display_name:a.name,email:a.email})));
  await insert("role_assignments",await Promise.all(cohort.accounts.map(async a=>({...g,id:await id(`role:${a.id}`),person_id:a.id,role:a.role,department_id:a.role==="governance"||a.role==="parent"?null:cohort.department}))));
  await insert("student_profiles",cohort.students.map(s=>({...g,id:s.id,person_id:s.personId,department_id:cohort.department,register_number:s.srn,cohort_year:s.cohortYear,semester:s.semester,completed_course_codes:[]})));
  await insert("mentor_assignments",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`mentor-link:${s.id}`),student_id:s.id,faculty_person_id:s.mentorId,assigned_by:hod}))));
  await insert("parent_links",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`parent-link:${s.id}`),student_id:s.id,parent_person_id:s.parentId,relationship:"guardian"}))));
  await insert("parent_field_grants",(await Promise.all(cohort.students.map(async s=>Promise.all(["attendance","marks","fees","support"].map(async field=>({...g,id:await id(`grant:${s.id}:${field}`),parent_link_id:await id(`parent-link:${s.id}`),field_group:field})))))).flat());
  const date=(days:number)=>new Date(Date.parse(cohort.anchor)+days*86400000).toISOString();
  await insert("terms",[{...g,id:cohort.term,institution_id:cohort.institution,code:"2026-ODD",name:"Academic term",starts_on:date(-90).slice(0,10),ends_on:date(90).slice(0,10)}]);
  await insert("registration_windows",[{...g,id:await id("window"),term_id:cohort.term,department_id:cohort.department,opens_at:date(-90),closes_at:date(30),status:"open"}]);
  await insert("courses",cohort.courses.map(course=>({...g,id:course.id,department_id:cohort.department,code:course.code,title:course.title,credits:course.credits,description:`Develop practical understanding of ${course.title.toLowerCase()} through worked examples and critical review.`})));
  await insert("course_offerings",cohort.courses.map(course=>({...g,id:course.offeringId,course_id:course.id,term_id:cohort.term,section:"A",capacity:400,status:"published"})));
  await insert("faculty_assignments",await Promise.all(cohort.courses.map(async course=>({...g,id:await id(`teacher:${course.id}`),course_offering_id:course.offeringId,faculty_person_id:course.facultyId,assigned_by_person_id:hod}))));
  await insert("timetable_slots",await Promise.all(cohort.courses.map(async course=>({...g,id:await id(`schedule:${course.id}`),course_offering_id:course.offeringId,weekday:course.weekday,starts_at:"09:00",ends_at:"10:00",room:`Lab ${course.weekday}`}))));
  await insert("registrations",await Promise.all(cohort.students.flatMap(s=>cohort.courses.map(async course=>({...g,id:await id(`registration:${s.id}:${course.id}`),student_id:s.id,course_offering_id:course.offeringId,status:"registered",registered_at:date(-40)})))));
  await insert("registration_submissions",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`registration-submission:${s.id}`),student_id:s.id,term_id:cohort.term,status:"submitted",submitted_at:date(-40)}))));
  await insert("grading_scales",[{...g,id:await id("grade-scale"),department_id:cohort.department,label:"Academic grading scale",bands:demoBands}]);
  for(const course of cohort.courses){
    for(let day=0;day<10;day++){
      const session=await id(`session:${course.id}:${day}`);
      await insert("attendance_sessions",[{...g,id:session,course_offering_id:course.offeringId,session_date:date(-10+day).slice(0,10),topic:`${course.title}: seminar ${day+1}`,status:"submitted"}]);
      await insert("attendance_records",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`attendance:${s.id}:${course.id}:${day}`),attendance_session_id:session,student_id:s.id,status:day<s.presentSessions?"present":"absent",recorded_by_person_id:course.facultyId}))));
    }
    const assessment=await id(`assessment:${course.id}`),lesson=await id(`lesson:${course.id}`),assignment=await id(`assignment:${course.id}`);
    await insert("assessments",[{...g,id:assessment,course_offering_id:course.offeringId,title:"Course assessment",category:"CIE",maximum_score:100,weight_percent:100,published:true}]);
    await insert("marks",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`mark:${s.id}:${course.id}`),assessment_id:assessment,student_id:s.id,score:s.mark,feedback:"Review the reasoning and practise the next exercise.",recorded_by_person_id:course.facultyId,recorded_at:cohort.anchor}))));
    await insert("course_results",await Promise.all(cohort.students.map(async s=>{const band=demoBands.find(b=>s.mark>=b.minimum)!;return {...g,id:await id(`result:${s.id}:${course.id}`),student_id:s.id,course_offering_id:course.offeringId,percentage:s.mark,grade_point:band.points,letter:band.letter,scale_revision:0,published:true,recorded_by:course.facultyId};})));
    await insert("lms_lessons",[{...g,id:lesson,course_offering_id:course.offeringId,title:`Foundations of ${course.title}`,body:"Start with the learning objective. Work through one concrete example, identify the assumptions, and explain how you would check the result. Record your reasoning before comparing approaches.",published:true,created_by:course.facultyId}]);
    await insert("lms_assignments",[{...g,id:assignment,course_offering_id:course.offeringId,title:"Applied reasoning exercise",instructions:"Choose a course concept. Explain it using a worked example, test one failure case, and state what evidence would change your conclusion.",due_at:date(-3),maximum_score:20,published:true,created_by:course.facultyId}]);
    await insert("lms_activity",await Promise.all(cohort.students.map(async s=>({...g,id:await id(`activity:${s.id}:${course.id}`),student_id:s.id,course_offering_id:course.offeringId,resource_id:lesson,kind:"lesson_opened",occurred_at:date(-s.activityDays)}))));
    await insert("lms_submissions",await Promise.all(cohort.students.filter(s=>s.mark>=64).map(async s=>({...g,id:await id(`submission:${s.id}:${course.id}`),assignment_id:assignment,student_id:s.id,answer:"A clear objective, a worked example and a boundary check make the result easier to assess.",submitted_at:date(-4),score:s.mark>=78?Math.round(s.mark/5):null,feedback:s.mark>=78?"Clear reasoning. Add a counterexample to strengthen the answer.":"",graded_by:s.mark>=78?course.facultyId:null,graded_at:s.mark>=78?date(-2):null}))));
  }
  await insert("fee_invoices",await Promise.all(cohort.students.map(async(s,i)=>({...g,id:await id(`invoice:${s.id}`),student_id:s.id,term_id:cohort.term,invoice_number:`AURA-${String(i+1).padStart(4,"0")}`,description:"Semester tuition and laboratory fee",record_origin:"generated_project_operations",amount_paise:4500000,due_on:date(30).slice(0,10),status:"due"}))));
  await insert("ch11_sources",await Promise.all(cohort.students.flatMap(s=>["internship","placement"].map(async source=>({...g,id:await id(`${source}:${s.id}`),student_id:s.id,source,record:sourceSchema.parse({source,studentId:s.id,recordId:await id(`${source}:${s.id}`),observedAt:cohort.anchor,semester:"2026-ODD",state:"present",synthetic:true,values:{...(source==="internship"?{missedMilestones:s.missedMilestones}:{missedActivities:s.missedActivities}),origin:"generated_project_operations"}})})))));
  await insert("project_dataset",[{id:cohort.generation,dataset_hash:cohort.seed,review,provenance:cohort.provenance}]);
  await c.query("INSERT INTO institution_revisions(singleton,current_generation_id,revision) VALUES(true,$1,1)",[cohort.generation]);
},"exclusive");await writeFile(resolve(out,"cohort.json"),JSON.stringify(cohort,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({students:cohort.students.length,accounts:cohort.accounts.length,courses:cohort.courses.length,rawValuesPreserved:review.students.reduce((total,student)=>total+student.reports.reduce((sum,report)=>sum+report.courses.length,0),0)}));}finally{await closePool();}
