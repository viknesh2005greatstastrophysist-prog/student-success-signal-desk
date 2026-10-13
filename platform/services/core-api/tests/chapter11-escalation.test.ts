import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {acceptanceChecks,compose,demoPolicy,formatSkill,riskAnalysis,sourceNames,type Evidence} from '../lib/chapter11/engine';
const id=randomUUID();
const evidence=Object.fromEntries(sourceNames.map(source=>[source,{source,studentId:id,recordId:source,observedAt:new Date().toISOString(),semester:'TEST',state:'present',synthetic:true,values:source==='academic'?{attendancePct:50,markPct:50}:source==='lms'?{inactivityDays:9,overdueAssignments:2}:source==='internship'?{missedMilestones:1}:{missedActivities:1}}])) as unknown as Evidence;
const risk=riskAnalysis(evidence,demoPolicy),baseline=formatSkill(risk,'academic');
for(const name of ['alerts_cite_triggers','thresholds_faculty_set','advisor_review_required','privacy_scope_enforced'] as const){
 test(`Persistent injected ${name} fault escalates after bounded repair`,async()=>{
  const e=structuredClone(evidence),packet=structuredClone(baseline),guard={version:demoPolicy.version,facultyApproved:true};
  if(name==='alerts_cite_triggers')packet.citations=[];
  if(name==='thresholds_faculty_set')guard.facultyApproved=false;
  if(name==='advisor_review_required')packet.actions[0]!.owner='student';
  if(name==='privacy_scope_enforced')e.placement.studentId=randomUUID();
  assert.equal(acceptanceChecks(packet,e,risk,'academic',guard).valid,false);
  let calls=0;
  const result=await compose({evidence:e,risk,baseline,domain:'academic',references:[],policyGuard:guard},{modelId:'persistent-fault-fixture',generate:async()=>{calls++;return packet;}});
  assert.equal(calls,3);assert.equal(result.validation.repairs.length,2);
  assert.equal(result.validation.valid,false);assert.equal(result.validation.escalated,true);
  assert.ok(result.validation.failures.length);assert.equal(result.validation.selection.selected,'template-offered-for-human-review');
 });
}
