import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { withCoreTransaction, closePool } from "../lib/db";
import { approvePolicy, savePlan, lockPlan, executePlan, exportPlan } from "../lib/chapter11/service";
import { demoPolicy } from "../lib/chapter11/engine";
import { configuredComposer } from "../lib/chapter11/provider";
import type { ActorContext } from "@aura/contracts";
import type { ProjectCohort } from "../lib/project-cohort";
import { decideSupportCase } from "../lib/support-commands";
process.umask(0o077);
if(process.env.AURA_LOCAL_PROJECT!=="1" || process.env.CORE_IDENTITY_REALM!=="project")throw new Error("Private project mode required");
const folder=new URL("../../../../runtime/project-final/",import.meta.url),cohort=JSON.parse(await readFile(new URL("cohort.json",folder),"utf8")) as ProjectCohort;
// Brief 11: every case going to mentor review gets its own grounded draft;
// cross-student profile reuse is retired (see lib/chapter11/project-composer.ts).
const provider=configuredComposer();
if(!provider)throw new Error("No AI model is configured. Every review runs on AI: set GROQ_API_KEY or CH11_MODEL and CH11_MODEL_BASE_URL first.");
const report:{plans:Array<{id:string;students:number;statuses:Record<string,number>}>;model:unknown;studentCount:number;cycle:string;realMentorApprovalClaimed:boolean}={plans:[],model:{configured:!!provider},studentCount:cohort.students.length,cycle:process.argv.includes("--final-cycle")?"final":"initial",realMentorApprovalClaimed:false};
try{
  for(const mentor of cohort.staff.filter(s=>s.role==="faculty")){
    const actor=await withCoreTransaction(async c=>{const person=(await c.query("SELECT external_subject FROM people WHERE id=$1",[mentor.id])).rows[0];return {subject:person.external_subject,personId:mentor.id,role:"faculty",departmentId:cohort.department} as ActorContext;});
    const existing=await withCoreTransaction(async c=>(await c.query<{id:string}>("SELECT id FROM ch11_policies WHERE faculty_person_id=$1 AND generation_id=$2 ORDER BY created_at LIMIT 1",[mentor.id,cohort.generation])).rows[0]);
    const policy=existing??await approvePolicy(actor,{policy:{...demoPolicy,version:"PROJECT-SUPPORT-V1"},rationale:"Project workflow policy for generated operational evidence; original report units remain unknown."},randomUUID());
    const students=cohort.students.filter(s=>s.mentorId===mentor.id);
    if(process.argv.includes("--final-cycle")){
      const older=await withCoreTransaction(async c=>(await c.query<{id:string;revision:number;artifact_id:string;content_hash:string}>("SELECT sc.id,sc.revision,a.id AS artifact_id,a.content_hash FROM ch11_jobs j JOIN ch11_plans p ON p.id=j.plan_id JOIN support_cases sc ON sc.id=j.support_case_id JOIN agent_runs r ON r.support_case_id=sc.id JOIN agent_artifacts a ON a.agent_run_id=r.id WHERE p.created_by=$1 AND p.generation_id=$2 AND p.body->>'request' LIKE 'Project cohort review %' AND sc.status='awaiting_faculty' AND a.artifact_version=(SELECT max(v.artifact_version) FROM agent_artifacts v WHERE v.agent_run_id=r.id)",[mentor.id,cohort.generation])).rows);
      for(const draft of older)await decideSupportCase(actor,draft.id,randomUUID(),{expectedRevision:draft.revision,artifactId:draft.artifact_id,contentHash:draft.content_hash,decision:"rejected",rationale:"Project workflow: superseded by the final review cycle with captured evidence revision metadata."});
    }
    for(let start=0;start<students.length;start+=50){
      const selected=students.slice(start,start+50).map(s=>s.id),request=process.argv.includes("--final-cycle")?`Academic support review · ${mentor.name} · Group ${Math.floor(start/50)+1}`:`Project cohort review ${mentor.email}:${start}`;
      const previous=await withCoreTransaction(async c=>(await c.query<{id:string;revision:number;status:string}>("SELECT id,revision,status FROM ch11_plans WHERE generation_id=$1 AND created_by=$2 AND body->>'request'=$3",[cohort.generation,actor.personId,request])).rows[0]);
      const plan=previous??await savePlan(actor,{request,studentIds:selected,domain:"academic",policyId:policy.id,feedback:"Use scoped evidence, preserve supplied-report unknowns and require mentor review."});
      if(plan.status!=="locked")await lockPlan(actor,plan.id,plan.revision);
      let statuses:Record<string,number>={};
      for(let round=0;round<20;round++){
        await executePlan(actor,plan.id,{concurrency:4,composer:provider});
        const output=await exportPlan(actor,plan.id);statuses={};
        for(const job of output.jobs){const status=String(job.status);statuses[status]=(statuses[status]??0)+1;}
        if(statuses.failed || statuses.blocked)throw new Error("Project cohort contains unresolved failed/blocked jobs; inspect stored failure reasons");
        if(!statuses.queued && !statuses.running)break;
      }
      if(statuses.queued || statuses.running)throw new Error("Project execution exceeded its bounded continuation budget; another worker may still hold a lease");
      report.plans.push({id:plan.id,students:selected.length,statuses});console.log(JSON.stringify({planCompleted:report.plans.length,students:selected.length,statuses}));
    }
  }
  report.model={modelId:provider.modelId,method:"per-case grounded packet-v2 drafts (no cross-student profile reuse)"};
  await writeFile(new URL("agent-execution.json",folder),JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({completedStudents:cohort.students.length,model:report.model,realMentorApprovalClaimed:false}));
}finally{await closePool();}
