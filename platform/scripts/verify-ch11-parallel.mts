/** Local real executePlan comparison. Creates pending technical reviews only;
 * never approves a case or changes original source or account records. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {withCoreTransaction,closePool,collectSnapshot} from '../services/core-api/lib/db.ts';
import {getCurrentGeneration} from '../services/core-api/lib/command-ledger.ts';
import {savePlan,lockPlan,executePlan,exportPlan,readSource} from '../services/core-api/lib/chapter11/service.ts';
import {digest,sourceNames} from '../services/core-api/lib/chapter11/engine.ts';
import type {ActorContext} from '@aura/contracts';
assert.equal(process.env.CORE_DATABASE_SCHEMA,'aura_project_core');
assert.match(process.env.DATABASE_URL??'',/127\.0\.0\.1/);
try {
 const data=await withCoreTransaction(async c=>{
  const g=await getCurrentGeneration(c);
  const mentor=(await c.query("SELECT p.id,p.email,p.display_name,r.department_id FROM people p JOIN role_assignments r ON r.person_id=p.id WHERE p.generation_id=$1 AND r.role='faculty' AND p.email='mentor1@aura.project.test' AND r.active",[g])).rows[0];
  const policy=(await c.query("SELECT id FROM ch11_policies WHERE generation_id=$1 AND faculty_person_id=$2 ORDER BY created_at DESC LIMIT 1",[g,mentor.id])).rows[0];
  const student=(await c.query("SELECT s.id FROM student_profiles s JOIN mentor_assignments m ON m.student_id=s.id WHERE s.generation_id=$1 AND m.faculty_person_id=$2 AND s.register_number <> '01FE23BCI103' ORDER BY s.register_number LIMIT 1",[g,mentor.id])).rows[0];
  return {mentor,policy,student};
 });
 const actor:ActorContext={personId:data.mentor.id,email:data.mentor.email,subject:data.mentor.email,displayName:data.mentor.display_name,departmentId:data.mentor.department_id,role:'faculty',clientId:'aura-faculty-portal'};
 // The imported readers all observe the same revision even on separate sessions.
 const capture=await collectSnapshot(sourceNames.map(name=>()=>readSource(actor,data.student.id,name)));
 assert.equal(capture.results.length,4); assert.ok(capture.timings.every(t=>Number.isFinite(t)&&t>0));
 const runs=[];
 for(const collectorConcurrency of [1,4,4,1,1,4] as const){
  const plan=await savePlan(actor,{request:'Technical source concurrency measurement',studentIds:[data.student.id],domain:'academic',policyId:data.policy.id,mode:'deterministic',feedback:'Compare the real path. Leave all resulting cases pending.'});
  const locked=await lockPlan(actor,plan.id,plan.revision);
  const execution=await executePlan(actor,locked.id,{concurrency:1,collectorConcurrency});
  assert.ok(execution.results.every(r=>'completed' in r && r.completed),JSON.stringify(execution.results));
  const saved=await exportPlan(actor,plan.id); const cp=saved.jobs[0].checkpoint;
  assert.ok(cp.sourceTimings && Object.values(cp.sourceTimings).every(t=>typeof t==='number'&&t>0));
  assert.equal(execution.alignment.planHash,locked.plan_hash);
  runs.push({collectorConcurrency,elapsedMs:execution.elapsedMs,sourceTimings:cp.sourceTimings,evidenceRevision:cp.evidenceRevision,qualityHash:digest({risk:cp.risk,packet:cp.composed?.packet,valid:cp.composed?.validation.valid}),status:saved.jobs[0].status});
 }
 assert.equal(new Set(runs.map(r=>r.qualityHash)).size,1,'Sequential and parallel quality must match');
 const median=(n:number)=>runs.filter(r=>r.collectorConcurrency===n).map(r=>r.elapsedMs).sort((a,b)=>a-b)[1]!;
 const report={status:'passed',path:'executePlan (real local college project sources; no sleeps)',runs,sequentialMedianMs:median(1),parallelMedianMs:median(4),parallelFaster:median(4)<median(1),qualityMatched:true,noMentorDecisionsCreated:true};
 await writeFile('../runtime/streamlit-project/brief3-benchmark.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({sequentialMedianMs:report.sequentialMedianMs,parallelMedianMs:report.parallelMedianMs,parallelFaster:report.parallelFaster,qualityMatched:true}));
} finally{await closePool();}
