import { createHash, randomUUID } from "node:crypto";
import { demoMentors, demoStudents, type ActorContext } from "@aura/contracts";
import { getPool, withCoreTransaction } from "./db";
import { getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { experienceCommand, recordChange } from "./experience-commands";
import { lmsCommand } from "./lms-commands";
import { demoPolicy } from "./chapter11/engine";
import { approvePolicy, savePlan, lockPlan, executePlan, seedChapterSources } from "./chapter11/service";

export const cohortVersion = "AURA-COHORT-10-V1";
const reason = "Populate the fictional ten-student project demonstration; no real student records or mentor decisions.";
const scenarios = [
  { present: 7, mark: 86, activity: "graded", note: "Review internship milestones and the next placement practice session." },
  { present: 4, mark: 52, activity: "submitted", note: "Agree on an attendance plan and practise the questions missed in the last review." },
  { present: 3, mark: 45, activity: "none", note: "Help the student open the LMS, identify missed lessons and agree on one catch-up task." },
  { present: 8, mark: 91, activity: "graded", note: "Discuss the next project challenge and keep the current study routine." },
  { present: 5, mark: 70, activity: "opened", note: "Discuss recent absences and the next internship milestone." },
  { present: 4, mark: 48, activity: "none", note: "Arrange a mentor check-in about attendance, coursework and placement practice." },
  { present: 7, mark: 87, activity: "graded", note: "Review the completed practice task and choose the next learning goal." },
  { present: 6, mark: 65, activity: "submitted", note: "Work through the lower-scoring assessment questions and check progress next week." },
  { present: 8, mark: 92, activity: "graded", note: "Discuss project progress and confirm the next internship checkpoint." },
  { present: 5, mark: 56, activity: "opened", note: "Plan attendance recovery and complete the first assignment draft." },
] as const;

function key(generation: string, step: string) {
  const h = createHash("sha256").update(`${cohortVersion}:${generation}:${step}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
type Person = { id: string; email: string; display_name: string; external_subject: string; role: ActorContext["role"]; department_id: string | null; student_id: string | null; register_number: string | null };
type Offering = { id: string; code: string; title: string; description: string; credits: number; term_id: string; revision: number; section: string; capacity: number; status: string; faculty_id: string | null; weekday: number; starts_at: string; ends_at: string; room: string };

export async function demoCohortContext() {
  return withCoreTransaction(async c => {
    const generation = await getCurrentGeneration(c);
    const institution = (await c.query("SELECT code FROM institutions WHERE generation_id=$1", [generation])).rows;
    if (institution.length !== 1 || institution[0].code !== "AURA-DEMO") throw new Error("Population is restricted to the fictional AURA-DEMO institution.");
    const people = (await c.query<Person>(`SELECT p.id,p.email,p.display_name,p.external_subject,r.role,r.department_id,s.id AS student_id,s.register_number FROM people p JOIN role_assignments r ON r.person_id=p.id AND r.active LEFT JOIN student_profiles s ON s.person_id=p.id WHERE p.generation_id=$1`, [generation])).rows;
    const actor = (email: string): ActorContext => {
      const p = people.find(p => p.email === email);
      if (!p || !p.email.endsWith("@aura.invalid")) throw new Error(`Missing fictional account: ${email}`);
      return { subject: p.external_subject, personId: p.id, role: p.role, departmentId: p.department_id ?? undefined, studentId: p.student_id ?? undefined };
    };
    const hod = actor("hod.cse@aura.invalid");
    const students = demoStudents.map(p => {
      const a = actor(p.email);
      const record = people.find(row => row.id === a.personId)!;
      if (a.role !== "student" || a.departmentId !== hod.departmentId || !record.register_number?.startsWith("SYN-CSE-")) throw new Error("Unexpected student scope; no records changed.");
      return { ...p, actor: a, studentId: a.studentId! };
    });
    const mentors = demoMentors.map(p => ({ ...p, actor: actor(p.email) }));
    if (mentors.some(p => p.actor.role !== "faculty" || p.actor.departmentId !== hod.departmentId)) throw new Error("Unexpected mentor scope.");
    const courses = (await c.query<Offering>(`SELECT o.id,c.code,c.title,c.description,c.credits,o.term_id,o.revision,o.section,o.capacity,o.status,f.faculty_person_id AS faculty_id,ts.weekday,to_char(ts.starts_at,'HH24:MI') AS starts_at,to_char(ts.ends_at,'HH24:MI') AS ends_at,ts.room FROM course_offerings o JOIN courses c ON c.id=o.course_id JOIN timetable_slots ts ON ts.course_offering_id=o.id LEFT JOIN faculty_assignments f ON f.course_offering_id=o.id AND f.active WHERE o.generation_id=$1 AND c.department_id=$2 ORDER BY c.code,ts.weekday`, [generation, hod.departmentId])).rows;
    if (["CS301","CS401","CS402","CS403"].some(code => courses.filter(c => c.code === code).length !== 1)) throw new Error("Expected the original four CSE demo offerings, each with one timetable slot.");
    return { generation, hod, students, mentors, courses, governance: actor("governance@aura.invalid") };
  });
}

/** Additive, resumable population. Each completed step is recorded once; later user edits are preserved. */
export async function populateDemoCohort(report: (message: string) => void = () => {}) {
  const context = await demoCohortContext();
  const { generation, hod, students, mentors, courses } = context;
  const lock = await getPool().connect();
  await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`${cohortVersion}:${generation}`]);
  try {
    const priorStep = async (step: string) => withCoreTransaction(async c => {
      if (await getCurrentGeneration(c) !== generation) throw new Error("The demo generation changed; stop and inspect before resuming.");
      return (await c.query<{ payload: Record<string, unknown> }>("SELECT payload FROM domain_events WHERE generation_id=$1 AND command_id=$2", [generation, key(generation, step)])).rows[0]?.payload;
    });
    const command = async (step: string, actor: ActorContext, input: unknown, lms = false): Promise<string> => {
      const prior = await priorStep(step);
      if (prior) return String(prior.resourceId);
      const response = lms ? await lmsCommand(actor, key(generation, step), input) : await experienceCommand(actor, key(generation, step), input);
      return String(response.id);
    };
    const started = await priorStep("started");
    const anchor = String(started?.anchor ?? new Date().toISOString());
    if (!started) await withCoreTransaction(c => writeCommandLedger(c, { generationId: generation, commandId: key(generation,"started"), actorPersonId: hod.personId, aggregateType: "demo_cohort", aggregateId: generation, eventType: "demo.population_started", action: "populate-synthetic-cohort", topic: "demo.population", payload: { anchor, version: cohortVersion, synthetic: true, reason } }));
    const dateAfter = (days: number) => new Date(Date.parse(anchor) + days*86400000).toISOString().slice(0,10);

    for (const student of students) {
      const row = await withCoreTransaction(async c => (await c.query<{ faculty_person_id: string; revision: number }>("SELECT faculty_person_id,revision FROM mentor_assignments WHERE generation_id=$1 AND student_id=$2", [generation,student.studentId])).rows[0]);
      if (row?.faculty_person_id !== mentors[student.mentor]!.actor.personId && !await priorStep(`mentor:${student.email}`)) {
        if (row && (row.revision !== 0 || row.faculty_person_id !== mentors[0]!.actor.personId)) throw new Error(`Preserving a manually changed mentor assignment for ${student.name}. Review before populating.`);
        await command(`mentor:${student.email}`, hod, { action: "assign-mentor", studentId: student.studentId, facultyId: mentors[student.mentor]!.actor.personId, expectedRevision: row?.revision ?? -1, reason });
      }
    }
    report("Mentor assignments ready: 4 / 3 / 3.");

    const agentCourse = courses.find(c => c.code === "CS401")!;
    if (agentCourse.status === "draft") await command("publish:CS401", hod, { action: "save-course", id: agentCourse.id, expectedRevision: agentCourse.revision, termId: agentCourse.term_id, code: agentCourse.code, title: agentCourse.title, description: agentCourse.description, credits: agentCourse.credits, section: agentCourse.section, capacity: agentCourse.capacity, status: "published", facultyId: mentors[0]!.actor.personId, slots: [{ weekday: agentCourse.weekday, startsAt: agentCourse.starts_at, endsAt: agentCourse.ends_at, room: agentCourse.room }], reason });

    for (const [i,student] of students.entries()) {
      const submitted = await withCoreTransaction(async c => (await c.query<{ status: string; revision: number }>("SELECT status,revision FROM registration_submissions WHERE generation_id=$1 AND student_id=$2 AND term_id=$3", [generation,student.studentId,agentCourse.term_id])).rows[0]);
      if (submitted?.status === "submitted" || await priorStep(`register:${student.email}`)) continue;
      const existing = await withCoreTransaction(async c => (await c.query<{ course_offering_id: string }>("SELECT course_offering_id FROM registrations WHERE generation_id=$1 AND student_id=$2 AND status='registered'", [generation,student.studentId])).rows.map(r=>r.course_offering_id));
      const planned = courses.filter(c => i===0 ? c.code === "CS401" : ["CS301","CS402","CS403"].includes(c.code)).map(c=>c.id);
      await command(`register:${student.email}`,student.actor,{action:"submit-registration",termId:agentCourse.term_id,offeringIds:[...new Set([...existing,...planned])],expectedRevision:submitted?.revision ?? -1});
    }
    report("Course registrations and timetables ready; existing final selections preserved.");

    const content: Record<string, {lesson: string; body: string; assignment: string; answer: string}> = {
      CS301: { lesson: "Check a model before trusting its score", body: "Separate training and test data. Compare the model with a simple baseline. Look at false positives and false negatives before deciding whether the result is useful.", assignment: "Explain a model evaluation", answer: "I would keep the test set separate and compare precision and recall with a baseline. A high accuracy score can hide errors in the smaller group." },
      CS401: { lesson: "Trace a student support review", body: "The collectors read attendance, marks, LMS and career records. The coordinator checks the evidence, applies the thresholds and asks a specialist to suggest support. The validator checks the suggestion. The mentor decides what to share.", assignment: "Trace evidence to a support suggestion", answer: "A low-attendance signal must point to recorded classes. The suggested catch-up meeting stays with the mentor for review before any support plan is shared." },
      CS402: { lesson: "Separate a warning from a conclusion", body: "A warning identifies a pattern worth checking. It cannot explain why the pattern happened. Show the evidence, describe its limits and give the student a chance to explain their situation.", assignment: "Review an early-warning decision", answer: "Attendance below a threshold is a reason to ask what happened. It is not proof that the student will fail. The mentor should check the records and discuss suitable support." },
      CS403: { lesson: "Retry a request without repeating its effect", body: "A network request can succeed even when its reply is lost. Give each logical action an idempotency key. When the client retries, return the stored result instead of repeating the action.", assignment: "Design a safe assignment retry", answer: "The client keeps the same request ID after a timeout. The server stores the result for that ID. A retry returns the first submission result and does not create a second submission." },
    };
    for (const course of courses) {
      const teacher = mentors.find(m=>m.actor.personId===course.faculty_id)?.actor ?? (course.code==="CS401"?mentors[0]!.actor:undefined);
      if (!teacher) throw new Error(`No demo teacher for ${course.code}`);
      const roster = await withCoreTransaction(async c => (await c.query<{ student_id: string }>("SELECT student_id FROM registrations WHERE generation_id=$1 AND course_offering_id=$2 AND status='registered'", [generation,course.id])).rows.map(r=>r.student_id));
      const enrolled = students.filter(s=>roster.includes(s.studentId));
      if (!enrolled.length) continue;
      // Eight fictional weekly classes on this course's timetable day, never in the future.
      const last = new Date(`${dateAfter(0)}T00:00:00Z`);
      last.setUTCDate(last.getUTCDate() - ((last.getUTCDay()+6)%7+1-course.weekday+7)%7);
      for (let n=0;n<8;n++) await command(`attendance:${course.code}:${n}`,teacher,{action:"save-attendance",offeringId:course.id,sessionDate:new Date(last.getTime()-(7-n)*7*86400000).toISOString().slice(0,10),topic:`Demo class ${n+1}: ${course.title}`,records:enrolled.map(s=>({studentId:s.studentId,status:n<scenarios[students.indexOf(s)]!.present?"present":"absent"})),reason});
      for (let n=0;n<2;n++) await command(`marks:${course.code}:${n}`,teacher,{action:"save-marks",offeringId:course.id,title:`Demo assessment ${n+1}: ${course.title}`,maximumScore:100,weightPercent:20,marks:enrolled.map(s=>({studentId:s.studentId,score:scenarios[students.indexOf(s)]!.mark-(n?4:0),feedback:`Fictional example. ${scenarios[students.indexOf(s)]!.note}`})),reason});
      for (const student of enrolled) {
        const exists = await withCoreTransaction(async c => (await c.query("SELECT id FROM course_results WHERE generation_id=$1 AND student_id=$2 AND course_offering_id=$3", [generation,student.studentId,course.id])).rowCount);
        if (!exists) await command(`result:${course.code}:${student.email}`,teacher,{action:"publish-result",studentId:student.studentId,offeringId:course.id,expectedRevision:-1,percentage:scenarios[students.indexOf(student)]!.mark,published:true,reason});
      }
      const item=content[course.code]!;
      const lesson=await command(`lesson:${course.code}`,teacher,{action:"save-lesson",offeringId:course.id,title:item.lesson,body:`Fictional project demonstration.\n\n${item.body}`,published:true,position:10,materialUrl:""},true);
      const assignment=await command(`assignment:${course.code}`,teacher,{action:"save-assignment",offeringId:course.id,title:item.assignment,instructions:`Demonstration coursework. Write a short answer in your own words.\n\n${item.body}`,dueAt:`${dateAfter(7)}T11:30:00Z`,maximumScore:20,published:true,allowLate:true},true);
      for (const student of enrolled) {
        const scenario=scenarios[students.indexOf(student)]!;
        if (scenario.activity==="none") continue;
        await command(`open:${course.code}:${student.email}`,student.actor,{action:"open-lesson",lessonId:lesson},true);
        if (scenario.activity==="opened") continue;
        const submission=await command(`submission:${course.code}:${student.email}`,student.actor,{action:"submit-assignment",assignmentId:assignment,expectedRevision:-1,answer:`Fictional demonstration answer: ${item.answer}`},true);
        if (scenario.activity==="graded") await command(`feedback:${course.code}:${student.email}`,teacher,{action:"publish-feedback",submissionId:submission,expectedRevision:0,score:Math.round(scenario.mark/5),feedback:"Demonstration feedback: the reasoning is clear. Add one concrete example and explain how you would check your conclusion."},true);
      }
    }
    report("Attendance, assessments, GPA results and LMS examples saved.");

    for (const [i,student] of students.entries()) {
      const scenario=scenarios[i]!;
      await command(`followup:${student.email}`,mentors[student.mentor]!.actor,{action:"save-followup",studentId:student.studentId,dueOn:dateAfter(i===5?-1:i===6?-2:2+i%4),note:`Fictional demo follow-up: ${scenario.note}`,shared:true,status:i===6?"completed":i===1||i===5?"in_progress":"planned",outcome:i===6?"Fictional example outcome: the practice task was reviewed and the next goal was agreed.":"",reason});
      await withCoreTransaction(async c=>{
        if(await getCurrentGeneration(c)!==generation)throw new Error("Demo generation changed");
        const exists=await c.query("SELECT id FROM fee_invoices WHERE generation_id=$1 AND student_id=$2 AND term_id=$3",[generation,student.studentId,agentCourse.term_id]);
        if(exists.rowCount)return;
        const id=randomUUID();
        await c.query("INSERT INTO fee_invoices(id,generation_id,student_id,term_id,invoice_number,description,amount_paise,due_on,status) VALUES($1,$2,$3,$4,$5,$6,4500000,$7,'due')",[id,generation,student.studentId,agentCourse.term_id,`INV-AURA-COHORT-${String(i+1).padStart(3,"0")}`,"Demonstration semester tuition and laboratory fee; simulated payment only",dateAfter(14)]);
        await recordChange(c,generation,hod,"fee_invoices",id,reason,null,{studentId:student.studentId,amountPaise:4500000,synthetic:true});
        await writeCommandLedger(c,{generationId:generation,commandId:key(generation,`invoice:${student.email}`),actorPersonId:hod.personId,aggregateType:"fee_invoices",aggregateId:id,eventType:"demo.invoice_created",action:"populate-synthetic-invoice",topic:"demo.population",payload:{resourceId:id,studentId:student.studentId,synthetic:true}});
      });
    }
    const missingCareer=await withCoreTransaction(async c=>(await c.query("SELECT 1 FROM student_profiles s WHERE s.generation_id=$1 AND s.department_id=$2 AND (NOT EXISTS(SELECT 1 FROM ch11_sources x WHERE x.student_id=s.id AND x.source='internship') OR NOT EXISTS(SELECT 1 FROM ch11_sources x WHERE x.student_id=s.id AND x.source='placement')) LIMIT 1",[generation,hod.departmentId])).rowCount);
    if(missingCareer)await seedChapterSources(context.governance);
    for(const [index,mentor] of mentors.entries()) {
      const policy=await approvePolicy(mentor.actor,{policy:demoPolicy,rationale:reason},key(generation,`policy:${mentor.email}`));
      const plan=await savePlan(mentor.actor,{request:`Demo cohort: review ${mentor.name}'s students and identify who needs support`,studentIds:students.filter(s=>s.mentor===index).map(s=>s.studentId),domain:"academic",policyId:policy.id,mode:"deterministic"},undefined,undefined,key(generation,`plan:${mentor.email}`));
      if(plan.status!=="locked")await lockPlan(mentor.actor,plan.id,plan.revision);
      const pending=await withCoreTransaction(async c=>(await c.query("SELECT id FROM ch11_jobs WHERE plan_id=$1 AND status IN ('queued','blocked','failed','running')",[plan.id])).rowCount);
      if(pending){const run=await executePlan(mentor.actor,plan.id);if(run.results.some(r=>"error" in r))throw new Error(`Review needs inspection: ${JSON.stringify(run.results)}`);}
    }
    report("Three cohort reviews processed; support suggestions await mentor decisions.");
    return await demoCohortReport();
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`${cohortVersion}:${generation}`]);
    lock.release();
  }
}

export async function demoCohortReport() {
  const {generation,hod}=await demoCohortContext();
  return withCoreTransaction(async c=>({
    version:cohortVersion,generation,synthetic:true,
    mentors:(await c.query("SELECT p.display_name AS mentor,count(*)::int AS students FROM mentor_assignments m JOIN people p ON p.id=m.faculty_person_id JOIN student_profiles s ON s.id=m.student_id WHERE m.generation_id=$1 AND s.department_id=$2 GROUP BY p.email,p.display_name ORDER BY p.email",[generation,hod.departmentId])).rows,
    students:(await c.query(`SELECT p.display_name AS student,mp.display_name AS mentor,(SELECT count(*)::int FROM registrations r WHERE r.student_id=s.id AND r.status='registered') AS courses,(SELECT count(*)::int FROM attendance_records a WHERE a.student_id=s.id) AS attendance_records,(SELECT count(*)::int FROM marks m WHERE m.student_id=s.id) AS marks,(SELECT count(*)::int FROM lms_activity l WHERE l.student_id=s.id) AS lms_activity,(SELECT count(*)::int FROM support_followups f WHERE f.student_id=s.id) AS followups,(SELECT count(*)::int FROM fee_invoices f WHERE f.student_id=s.id) AS invoices FROM student_profiles s JOIN people p ON p.id=s.person_id JOIN mentor_assignments ma ON ma.student_id=s.id JOIN people mp ON mp.id=ma.faculty_person_id WHERE s.generation_id=$1 AND s.department_id=$2 ORDER BY s.register_number`,[generation,hod.departmentId])).rows,
    reviews:(await c.query("SELECT p.display_name AS student,j.status,j.checkpoint->'risk'->>'score' AS score,j.checkpoint->'risk'->>'band' AS band FROM ch11_jobs j JOIN student_profiles s ON s.id=j.student_id JOIN people p ON p.id=s.person_id JOIN ch11_plans pl ON pl.id=j.plan_id WHERE j.generation_id=$1 AND pl.id=ANY($2::uuid[]) ORDER BY s.register_number",[generation,demoMentors.map(m=>key(generation,`plan:${m.email}`))])).rows,
  }));
}
