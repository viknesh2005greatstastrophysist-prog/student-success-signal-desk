/** Local real executePlan comparison. Creates pending technical reviews only;
 * never approves a case or changes original source or account records. */
import assert from 'node:assert/strict';

import {withCoreTransaction,closePool,collectSnapshot} from '../services/core-api/lib/db.ts';
import {getCurrentGeneration} from '../services/core-api/lib/command-ledger.ts';
import {savePlan,lockPlan,executePlan,exportPlan,readSource} from '../services/core-api/lib/chapter11/service.ts';
import {sourceNames} from '../services/core-api/lib/chapter11/engine.ts';
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
 const make=async(mode:string)=>{const p=await savePlan(actor,{request:'Technical bounded failure check',studentIds:[data.student.id],domain:'academic',policyId:data.policy.id,mode,feedback:'Failure injection only; never approve.'});return lockPlan(actor,p.id,p.revision);};
 const p=await make('model');
 const report=await executePlan(actor,p.id,{composer:{modelId:'test-double-no-cloud-call',generate:async context=>({...context.baseline,citations:[]})}});
 assert.ok(report.results[0] && 'escalated' in report.results[0]);
 const saved=await exportPlan(actor,p.id); assert.ok(saved.jobs[0].escalated_at);assert.equal(saved.jobs[0].support_case_id,null);assert.equal(saved.jobs[0].checkpoint.composed.validation.repairs.length,2);
 assert.equal((await executePlan(actor,p.id)).results.length,0);
 const retry=await make('deterministic');
 for(let attempt=0;attempt<3;attempt++)await executePlan(actor,retry.id,{stopAfterStage:'risk'});
 const capped=await exportPlan(actor,retry.id);assert.equal(capped.jobs[0].attempts,3);assert.ok(capped.jobs[0].escalated_at);assert.equal((await executePlan(actor,retry.id)).results.length,0);
 console.log('Brief 4: persisted repair escalation, diagnosis, no publication, and three-attempt cap passed.');
} finally{await closePool();}
