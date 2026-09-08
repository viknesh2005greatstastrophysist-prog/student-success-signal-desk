import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { withCoreTransaction,closePool } from "../lib/db";
import { getCurrentGeneration } from "../lib/command-ledger";
import { publishAndAssignOffering } from "../lib/commands";
import { registerForOffering } from "../lib/registration-commands";

if(!/^aura_core_test_/.test(process.env.CORE_DATABASE_SCHEMA ?? ""))throw new Error("This browser test setup is restricted to isolated test schemas");
try{
  const context=await withCoreTransaction(async client=>{
    const generation=await getCurrentGeneration(client);
    const rows=await client.query<{id:string;email:string;role:ActorContext["role"];department_id:string;student_id:string|null}>("SELECT p.id,p.email,r.role,r.department_id,s.id AS student_id FROM people p JOIN role_assignments r ON r.person_id=p.id LEFT JOIN student_profiles s ON s.person_id=p.id WHERE p.generation_id=$1",[generation]);
    const actor=(email:string):ActorContext=>{const p=rows.rows.find(p=>p.email===email)!;return {subject:email,role:p.role,personId:p.id,departmentId:p.department_id,studentId:p.student_id ?? undefined};};
    const course=(await client.query<{id:string;status:string;revision:number}>("SELECT o.id,o.status,o.revision FROM course_offerings o JOIN courses c ON c.id=o.course_id WHERE o.generation_id=$1 AND c.code='CS401'",[generation])).rows[0]!;
    const student=actor("student1@aura.invalid");
    const registered=(await client.query("SELECT id FROM registrations WHERE generation_id=$1 AND student_id=$2 AND course_offering_id=$3 AND status='registered'",[generation,student.studentId,course.id])).rowCount;
    return {course,registered,student,faculty:actor("faculty1@aura.invalid"),hod:actor("hod.cse@aura.invalid")};
  });
  if(context.course.status==="draft")await publishAndAssignOffering(context.hod,context.course.id,randomUUID(),{facultyPersonId:context.faculty.personId,expectedRevision:context.course.revision});
  if(!context.registered)await registerForOffering(context.student,randomUUID(),{offeringId:context.course.id});
  console.log("Isolated LMS browser course is ready; publication and registration used the domain commands.");
}finally{await closePool();}
