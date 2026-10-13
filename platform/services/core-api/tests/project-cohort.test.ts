import { requireSandboxInvoiceOrigin } from "../lib/security";
import { requireHostedCollegeEnvironment } from "@aura/contracts";
import { createServer } from "node:http";
import type { GenerationContext } from "../lib/chapter11/engine";
import assert from "node:assert/strict";
import test from "node:test";
import { generateProjectCohort } from "../lib/project-cohort";
import { buildCollegeAttendanceReview } from "../lib/chapter11/college-attendance-review";
import { fixture } from "./fixtures/college-attendance";
import { projectProfileComposer } from "../lib/chapter11/project-composer";
import { demoPolicy, formatSkill, riskAnalysis, sourceNames, type Evidence, digest } from "../lib/chapter11/engine";
import { loadCoreConfig } from "../lib/config";
import { configuredComposer } from "../lib/chapter11/provider";
import { requireDemoInstitution, requireSyntheticInstitution } from "../lib/security";
import { identityMode } from "../../auth-server/lib/identity-mode";
const review=()=>{const data=fixture();return buildCollegeAttendanceReview(data,[{...data.enrollments[0]!,studentName:"Fictional Test Student",srn:"TEST001"}],{schemaVersion:"aura.college-source-context.v1",datasetId:data.datasetId,permission:{status:"user_confirmed",confirmedOn:"2026-10-12",statement:"Fictional fixture only",basis:"user_statement"},clarification:{zeroMeaning:"unconfirmed",zeroHypothesis:"Unknown",naMeaning:null,tnsMeaning:null,numericUnit:null,academicTerm:null,periodStart:null,periodEnd:null}});};
test("project generation is deterministic, relationally coherent and preserves all original raw unknowns",()=>{
  const original=review(),before=digest(original),first=generateProjectCohort(original,"2026-10-12T00:00:00.000Z");
  assert.deepEqual(generateProjectCohort(original,first.anchor),first);assert.equal(digest(original),before);
  assert.equal(first.students[0]!.id,original.students[0]!.id);assert.equal(first.students[0]!.srn,"TEST001");
  assert.equal(first.students[0]!.rawCells,4);assert.equal(first.accounts.length,7);assert.equal(new Set(first.accounts.map(a=>a.id)).size,7);
  assert.ok(first.staff.some(s=>s.id===first.students[0]!.mentorId && s.role==="faculty"));assert.match(first.provenance.sourceDefinitions,/unknown/);
  assert.throws(()=>generateProjectCohort(original,"unknown"));
});
test("private project database cannot point at cloud or institution/demo schemas",()=>{
  assert.throws(()=>loadCoreConfig({DATABASE_URL:"postgres://x:y@remote.example/db",CORE_IDENTITY_REALM:"project",AURA_LOCAL_PROJECT:"1",CORE_DATABASE_SCHEMA:"aura_project_core"}));
  assert.throws(()=>loadCoreConfig({DATABASE_URL:"postgres://x:y@127.0.0.1/db",CORE_IDENTITY_REALM:"project",AURA_LOCAL_PROJECT:"1",CORE_DATABASE_SCHEMA:"aura_core"}));
  assert.throws(()=>identityMode({AURA_IDENTITY_MODE:"project",AURA_LOCAL_PROJECT:"1",DATABASE_URL:"postgres://x:y@remote.example/db",AUTH_DATABASE_SCHEMA:"aura_project_identity",CORE_DATABASE_SCHEMA:"aura_project_core"}));
});
test("private project model cannot send context to a remote HTTPS endpoint",()=>{
  const names=["CORE_IDENTITY_REALM","CH11_MODEL","CH11_MODEL_BASE_URL","CH11_MODEL_API_KEY"] as const;
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try { Object.assign(process.env,{CORE_IDENTITY_REALM:"project",CH11_MODEL:"FICTIONAL",CH11_MODEL_BASE_URL:"https://remote.example/v1",CH11_MODEL_API_KEY:"TEST"});assert.throws(()=>configuredComposer(),/loopback/); }
  finally { for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];} }
});
test("shared model profile cannot copy another case's facts and citations",async()=>{
  const evidence=(id:string,attendance:number)=>Object.fromEntries(sourceNames.map(source=>[source,{source,studentId:id,recordId:`${id}:${source}`,observedAt:"2026-10-12T00:00:00.000Z",semester:"2026-ODD",state:"present",synthetic:true,values:source==="academic"?{attendancePct:attendance,markPct:40}:source==="lms"?{inactivityDays:2,overdueAssignments:0}:source==="internship"?{missedMilestones:0}:{missedActivities:0}}])) as unknown as Evidence;
  const profile=projectProfileComposer({modelId:"FICTIONAL-MODEL",async generate(context){return context.baseline;}});
  for(const studentId of ["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]){const sources=evidence(studentId,50),risk=riskAnalysis(sources,demoPolicy),baseline=formatSkill(risk,"academic");const packet=await profile.composer.generate({evidence:sources,risk,baseline,domain:"academic",references:[]});assert.deepEqual(packet,baseline);}
  assert.equal(profile.stats.actualModelCalls,1);assert.equal(profile.stats.reusedProfiles,1);
});

test("project mode refuses demo resets while its own ledger remains available",()=>{
  assert.throws(()=>requireDemoInstitution({CORE_IDENTITY_REALM:"project"}),/disabled/);
  requireSyntheticInstitution({CORE_IDENTITY_REALM:"project",CORE_DATABASE_SCHEMA:"aura_project_core"});
});

test("project database pins its port and name",()=>{
 const core={CORE_IDENTITY_REALM:"project",AURA_LOCAL_PROJECT:"1",CORE_DATABASE_SCHEMA:"aura_project_core"};
 const identity={...core,AURA_IDENTITY_MODE:"project",AUTH_DATABASE_SCHEMA:"aura_project_identity"};
 for(const DATABASE_URL of ["postgres://x:y@127.0.0.1:5432/aura_project","postgres://x:y@127.0.0.1:55432/other"]){assert.throws(()=>loadCoreConfig({...core,DATABASE_URL}));assert.throws(()=>identityMode({...identity,DATABASE_URL}));}
 assert.equal(loadCoreConfig({...core,DATABASE_URL:"postgres://x:y@127.0.0.1:55432/aura_project"}).databaseSchema,"aura_project_core");
});


test("model evidence is never forwarded through an HTTP redirect",async()=>{
 let forwarded=0;
 const server=createServer((request,response)=>{
  if(request.url==="/forwarded"){forwarded++;response.end("{}");return;}
  response.writeHead(307,{Location:"/forwarded"});response.end();
 });
 await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const names=["CORE_IDENTITY_REALM","CH11_MODEL","CH11_MODEL_BASE_URL","CH11_MODEL_API_KEY"] as const;
 const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  Object.assign(process.env,{CORE_IDENTITY_REALM:"project",CH11_MODEL:"TEST",CH11_MODEL_BASE_URL:`http://127.0.0.1:${address.port}/v1`,CH11_MODEL_API_KEY:""});
  await assert.rejects(()=>configuredComposer()!.generate({} as GenerationContext));assert.equal(forwarded,0);
 }finally{
  for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  server.closeAllConnections();await new Promise<void>((done,fail)=>server.close(error=>error?fail(error):done()));
 }
});


test("hosted college project pins its authorized TLS database and keeps demo entry disabled",()=>{
 const env={AURA_HOSTED_COLLEGE_PROJECT:"1",CORE_IDENTITY_REALM:"college-project",AURA_IDENTITY_MODE:"college-project",CORE_DATABASE_SCHEMA:"aura_hosted_project_core",AUTH_DATABASE_SCHEMA:"aura_hosted_project_identity",COLLEGE_DATABASE_HOST:"approved.example",COLLEGE_DATABASE_NAME:"college",DATABASE_URL:"postgresql://user:secret@approved.example/college?sslmode=require"};
 requireHostedCollegeEnvironment(env);assert.equal(identityMode(env),"college-project");assert.equal(loadCoreConfig(env).databaseSchema,env.CORE_DATABASE_SCHEMA);
 for(const change of [{AURA_IDENTITY_MODE:undefined},{AURA_IDENTITY_MODE:"demo"},{AURA_HOSTED_COLLEGE_PROJECT:"0"},{AURA_LOCAL_PROJECT:"1"},{CORE_DATABASE_SCHEMA:"aura_core"},{AUTH_DATABASE_SCHEMA:"aura_identity"},{DATABASE_URL:"postgres://user:secret@other.example/college?sslmode=require"},{DATABASE_URL:"postgres://user:secret@approved.example/other?sslmode=require"},{DATABASE_URL:"postgres://user:secret@approved.example/college?sslmode=disable"}])assert.throws(()=>requireHostedCollegeEnvironment({...env,...change}));
 assert.throws(()=>requireDemoInstitution(env),/disabled/);
});

test("hosted simulations cannot mark actual or unverified fee records paid",()=>{
 const env={CORE_IDENTITY_REALM:"college-project",CORE_DATABASE_SCHEMA:"aura_hosted_project_core"};
 for(const origin of ["unverified","college_import","institutional"])assert.throws(()=>requireSandboxInvoiceOrigin(origin,env),/cannot update/);
 requireSandboxInvoiceOrigin("generated_project_operations",env);
 assert.throws(()=>requireSandboxInvoiceOrigin("generated_project_operations",{CORE_IDENTITY_REALM:"institutional"}),/disabled/);
});

test("hosted schemas fail closed when deployment mode flags are omitted",()=>{
 const base={DATABASE_URL:"postgresql://user:secret@approved.example/college?sslmode=require",CORE_DATABASE_SCHEMA:"aura_hosted_project_core",AUTH_DATABASE_SCHEMA:"aura_hosted_project_identity"};
 assert.throws(()=>loadCoreConfig(base),/Hosted college/);assert.throws(()=>identityMode(base),/Hosted college/);
 assert.throws(()=>requireSandboxInvoiceOrigin("unverified",base),/cannot update/);
});

test("Vercel OIDC model authentication is restricted to the Gateway origin",async()=>{
 const names=["CORE_IDENTITY_REALM","CH11_MODEL","CH11_MODEL_BASE_URL","CH11_MODEL_API_KEY","VERCEL_OIDC_TOKEN"] as const;
 const prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));const originalFetch=globalThis.fetch;
 try{
  Object.assign(process.env,{CORE_IDENTITY_REALM:"college-project",CH11_MODEL:"TEST",CH11_MODEL_BASE_URL:"https://ai-gateway.vercel.sh/v1",CH11_MODEL_API_KEY:"",VERCEL_OIDC_TOKEN:"FICTIONAL_OIDC_TOKEN"});
  globalThis.fetch=async(_url,init)=>{assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer FICTIONAL_OIDC_TOKEN");assert.equal(init?.redirect,"error");assert.equal(JSON.parse(String(init?.body)).reasoning_effort,undefined);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:"TEST"})}}]}));};
  assert.deepEqual(await configuredComposer()!.generate({evidence:{} as Evidence,risk:{signals:[],score:0,band:"low",flagged:false,policyVersion:"TEST",reviewRequired:true},domain:"academic",references:[],baseline:{summary:"Mentor review requested for routine support.",actions:[],citations:[],prohibited:[]}}),{summary:"TEST"});
  process.env.CH11_MODEL_BASE_URL="https://other.example/v1";assert.equal(configuredComposer(),undefined);
 }finally{globalThis.fetch=originalFetch;for(const name of names){if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];}}
});
