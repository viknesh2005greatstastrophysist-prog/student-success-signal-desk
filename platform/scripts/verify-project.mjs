import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const hosted=process.argv.includes("--hosted"),accountFolder=new URL("../../runtime/project-final/",import.meta.url),folder=new URL(hosted?"../../runtime/hosted-project/":"../../runtime/project-final/",import.meta.url),accounts=JSON.parse(await readFile(new URL("accounts.json",accountFolder),"utf8")),cohort=JSON.parse(await readFile(new URL("cohort.json",accountFolder),"utf8"));
process.umask(0o077);
const studentIndex=Number(process.argv.find(a=>a.startsWith("--student-index="))?.split("=")[1]??0);
assert.ok(Number.isInteger(studentIndex)&&cohort.students[studentIndex],"valid acceptance student index");
const sites={student:3101,parent:3102,faculty:3103,hod:3104,governance:3105,lms:3106},contexts={},pages={},checks=[],errors=[];
const person={student:accounts.find(a=>a.id===cohort.students[studentIndex].personId),parent:accounts.find(a=>a.id===cohort.students[studentIndex].parentId),faculty:accounts.find(a=>a.id===cohort.students[studentIndex].mentorId),hod:accounts.find(a=>a.role==="hod"),governance:accounts.find(a=>a.role==="governance")};person.lms=person.student;
const browser=await chromium.launch({channel:"chrome",headless:true});
const production={student:"https://aura-student-portal.vercel.app",parent:"https://aura-parent-portal.vercel.app",faculty:"https://aura-faculty-portal.vercel.app",hod:"https://aura-hod-portal.vercel.app",governance:"https://aura-ai-governance.vercel.app",lms:"https://aura-lms-portal.vercel.app"};
const origin=portal=>hosted?production[portal]:`http://127.0.0.1:${sites[portal]}`;
let currentPortal="",lastLoginAt=0;
const json=async(page,path)=>{const result=await page.request.get(new URL(path,page.url()).href);return {status:result.status(),body:await result.json()};};
const post=async(page,path,input)=>page.evaluate(async({path,input})=>{const overview=await fetch(location.port==="3106"||location.hostname==="aura-lms-portal.vercel.app"?"/api/bff/lms/overview":"/api/bff/experience/overview",{cache:"no-store"});const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":overview.headers.get("x-csrf-token")??"","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{path,input});
async function screenshot(page,name){
  await page.waitForLoadState("networkidle");
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
  await page.evaluate(redactions=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){let text=node.textContent??"";for(const [value,label] of redactions)text=text.split(value).join(label);node.textContent=text;}},cohort.students.flatMap((student,i)=>[[student.name,`Student ${i+1}`],[student.srn,`Record ${i+1}`]]));
  await page.screenshot({path:fileURLToPath(new URL(name,folder)),fullPage:false});
}
try{
  for(const url of hosted?[...Object.values(production),"https://aura-identity-service.vercel.app","https://aura-core-api.vercel.app"]:[...Object.values(sites),3200,3300].map(port=>`http://127.0.0.1:${port}`)){
    let ready=false;
    for(let attempt=0;attempt<90;attempt++){
      try{await fetch(`${url}/`,{signal:AbortSignal.timeout(2000)});ready=true;break;}catch{await pageDelay(1000);}
    }
    assert.ok(ready,`service ${url} ready`);
  }
  for(const portal of Object.keys(sites)){
    currentPortal=portal;
    const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts[portal]=context;
    const page=await context.newPage();pages[portal]=page;page.on("pageerror",error=>errors.push(`${portal}: ${error.message}`));
    await page.goto(`${origin(portal)}/`);await page.getByRole("link",{name:"Sign in",exact:true}).click();
    await page.getByLabel("Account email",{exact:true}).fill(person[portal].email);await page.getByLabel("Password",{exact:true}).fill(person[portal].password);
    await pageDelay(Math.max(0,12000-(Date.now()-lastLoginAt)));lastLoginAt=Date.now();
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    for(let attempt=0;attempt<100;attempt++){
      if(await page.getByRole("button",{name:"Allow once",exact:true}).isVisible())await page.getByRole("button",{name:"Allow once",exact:true}).click();
      if(new URL(page.url()).origin===origin(portal) && await page.getByRole("button",{name:"Sign out",exact:true}).isVisible())break;
      await page.waitForTimeout(200);
    }
    try{await page.getByRole("button",{name:"Sign out",exact:true}).waitFor({timeout:10000});}catch{throw new Error(`${portal} login incomplete at ${new URL(page.url()).pathname}: ${(await page.getByRole("alert").allTextContents()).join(" ")}`);}
    const path=portal==="lms"?"/api/bff/lms/overview":"/api/bff/experience/overview",overview=await json(page,path);
    assert.equal(overview.status,200,`${portal} authenticated overview`);assert.equal(overview.body.ok,true);
    await page.goto(`${origin(portal)}/college-records`);
    await page.getByRole("heading",{name:"College source records",exact:true}).waitFor();
    const raw=await json(page,"/api/bff/college-sources");assert.equal(raw.status,200);assert.equal(raw.body.ok,true);
    assert.equal(raw.body.data.counts.students,portal==="faculty"?107:portal==="hod"||portal==="governance"?321:1);
    if(portal==="governance")assert.deepEqual(raw.body.data.students,[]);
    else if(["student","lms","parent"].includes(portal))assert.deepEqual(raw.body.data.students.map(s=>s.id),[cohort.students[studentIndex].id]);
    for(const width of [320,375,768,1024,1440]){
      await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${portal} raw source overflow`);
      await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{}))));
      const axe=await new AxeBuilder({page}).analyze();
      if(axe.violations.length)await writeFile(new URL(`${portal}-axe-${width}.json`,folder),JSON.stringify(axe.violations,null,2),{mode:0o600});
      assert.deepEqual(axe.violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>v.id),[],`${portal} source Axe ${width}`);
    }
    await screenshot(page,`${portal}-sources-redacted.png`);
    await page.goto(`${origin(portal)}/dashboard`);await page.getByRole("navigation",{name:"Portal sections",exact:true}).waitFor();
    const nav=page.getByRole("navigation",{name:"Portal sections",exact:true});const labels=await nav.getByRole("button").allTextContents();
    for(const label of labels){await nav.getByRole("button",{name:label,exact:true}).click();await page.waitForTimeout(120);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${portal} ${label} overflow`);}
    for(const width of [320,375,1440]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${portal} workspace overflow ${width}`);
      const a11y=await new AxeBuilder({page}).analyze();assert.deepEqual(a11y.violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>v.id),[],`${portal} workspace Axe ${width}`);
    }
    await page.emulateMedia({reducedMotion:"reduce"});assert.ok(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches));
    await page.emulateMedia({reducedMotion:"no-preference"});
    checks.push({portal,actualProjectOidcLogin:true,sourceScope:raw.body.data.counts.students,navigationSections:labels.length});
    if(process.argv.includes("--smoke"))break;
  }
  if(!process.argv.includes("--smoke")&&!process.argv.includes("--portals-only")){
    const student=pages.student,faculty=pages.faculty,parent=pages.parent,hod=pages.hod,lms=pages.lms;
    const denial=await json(student,`/api/bff/experience/students/${cohort.students[1].id}`);assert.ok([403,404].includes(denial.status));checks.push({denial:"student peer access",status:denial.status});
    const lmsOverview=await json(lms,"/api/bff/lms/overview");const course=lmsOverview.body.data.courses[0];assert.ok(course);
    const details=await json(lms,`/api/bff/lms/courses/${course.id}`);assert.equal(details.status,200);
    const lesson=details.body.data.lessons[0],assignment=details.body.data.assignments[0];assert.ok(lesson&&assignment);
    const opened=await post(lms,"/api/bff/lms/commands",{action:"open-lesson",lessonId:lesson.id});assert.equal(opened.body.ok,true);
    const submitted=await post(lms,"/api/bff/lms/commands",{action:"submit-assignment",assignmentId:assignment.id,expectedRevision:details.body.data.submissions.find(s=>s.assignment_id===assignment.id)?.revision??-1,answer:"A worked example and a counterexample make the reasoning testable."});assert.equal(submitted.body.ok,true);checks.push({journey:"LMS lesson and assignment persist",passed:true});
    // Wait for the bounded whole-cohort preparation before exercising mentor publication.
    let execution;for(let attempt=0;attempt<180;attempt++){try{execution=JSON.parse(await readFile(new URL("agent-execution.json",accountFolder),"utf8"));if(execution.cycle === "final")break;else await pageDelay(1000);}catch{await pageDelay(1000);}}
    assert.equal(execution?.studentCount,321,"whole-cohort agent run completed");
    const queue=await json(faculty,"/api/bff/chapter11/review"),draft=queue.body.data.drafts.find(d=>d.student_id===cohort.students[studentIndex].id);assert.ok(draft);
    const packet=structuredClone(draft.recommendation);packet.actions[0].dueInDays=5;
    await faculty.goto(`${origin("faculty")}/support`);await faculty.getByRole("heading",{name:"Plan a review. Follow the evidence."}).waitFor();
    const editor=faculty.locator("details").filter({has:faculty.locator("summary").filter({hasText:cohort.students[studentIndex].name})}).first();
    await editor.locator("summary").first().click();await editor.locator('[data-action-id="faculty-ch11-edit-due"]').first().fill("5");
    await editor.locator('[data-action-id="faculty-ch11-edit-reason"]').fill("Refine the check-in timing after reviewing the project evidence.");
    await editor.getByRole("button",{name:"Validate and save new draft version",exact:true}).click();
    await faculty.waitForFunction(async({id,revision})=>{const r=await fetch("/api/bff/chapter11/review",{cache:"no-store"});const body=await r.json();return body.data?.drafts.some(d=>d.id===id&&d.revision>revision);},{id:draft.id,revision:draft.revision});
    const stale=await post(faculty,`/api/bff/support/cases/${draft.id}/decisions`,{expectedRevision:draft.revision,artifactId:draft.artifact_id,contentHash:draft.content_hash,decision:"approved",rationale:"This prior version must be rejected after the edit."});assert.equal(stale.status,409);
    const fresh=(await json(faculty,"/api/bff/chapter11/review")).body.data.drafts.find(d=>d.id===draft.id);
    await editor.locator('[data-action-id="faculty-ch11-edit-reason"]').fill("Project acceptance: confirm the reviewed support actions and next check-in.");
    await editor.getByRole("button",{name:"Confirm support plan",exact:true}).click();
    await faculty.waitForFunction(async id=>{const r=await fetch("/api/bff/chapter11/review",{cache:"no-store"});const body=await r.json();return body.ok&&!body.data.drafts.some(d=>d.id===id);},draft.id);
    const readStudent=await json(student,`/api/bff/experience/students/${cohort.students[studentIndex].id}`);const readParent=await json(parent,`/api/bff/experience/students/${cohort.students[studentIndex].id}`);assert.equal(readStudent.body.ok,true);assert.equal(readParent.body.ok,true);
    assert.ok(JSON.stringify(readStudent.body.data).includes("faculty-check-in"));assert.ok(JSON.stringify(readParent.body.data).includes("faculty-check-in"));
    const approved=(await json(faculty,"/api/bff/chapter11/review")).body.data.plans.find(p=>p.student_id===cohort.students[studentIndex].id);assert.ok(approved?.visible_to_student);
    const withdrawn=await post(faculty,`/api/bff/chapter11/interventions/${approved.id}/outcome`,{expectedRevision:approved.revision,status:"withdrawn",outcome:"Project acceptance: withdraw support while reviewing the next step."});assert.equal(withdrawn.body.ok,true);
    const hidden=(await json(faculty,"/api/bff/chapter11/review")).body.data.plans.find(p=>p.id===approved.id);assert.equal(hidden.visible_to_student,false);
    const restored=await post(faculty,`/api/bff/chapter11/interventions/${approved.id}/outcome`,{expectedRevision:hidden.revision,status:"planned",outcome:"Project acceptance: restore the approved support version after review."});assert.equal(restored.body.ok,true);
    const staffDenied=await post(pages.governance,`/api/bff/chapter11/cases/${draft.id}/edit`,{expectedRevision:0,artifactId:fresh.artifact_id,packet,rationale:"An operator must not edit a mentor recommendation."});assert.ok([403,404].includes(staffDenied.status));
    const originalCounts=execution.plans.reduce((total,p)=>total+p.students,0);assert.equal(originalCounts,321);checks.push({journey:"edit, stale denial, approval, student/parent visibility, withdrawal, restore and operator denial",passed:true});
    await faculty.goto(`${origin("faculty")}/support`);await faculty.getByRole("heading",{name:"Plan a review. Follow the evidence."}).waitFor();
    await screenshot(faculty,"faculty-agents-redacted.png");
    await student.goto(`${origin("student")}/support`);await student.getByRole("button",{name:"Sign out",exact:true}).waitFor();await screenshot(student,"student-support-redacted.png");
    await parent.goto(`${origin("parent")}/fees`);await parent.getByRole("heading",{name:"Fees & receipts",exact:true,level:2}).waitFor();
    const payment=parent.getByRole("button",{name:/^Record payment of/}).first();
    await payment.waitFor();
    if(await payment.isVisible()){
      const [response]=await Promise.all([parent.waitForResponse(r=>r.url().includes("/payment-attempts")&&r.request().method()==="POST"),payment.click()]);
      const paid=await response.json();assert.equal(paid.ok,true);assert.equal(paid.data.transaction.status,"captured");
      const receipt=await parent.request.get(`${origin("parent")}/api/bff/receipts/${paid.data.transaction.id}`);assert.equal(receipt.status(),200);
      assert.ok((await receipt.text()).includes("Payment receipt"));checks.push({journey:"parent payment and downloadable receipt",passed:true});
    }
    const operations=pages.governance;await operations.goto(`${origin("governance")}/reviews`);
    const replay=operations.getByRole("button",{name:"Verify recorded run",exact:true}).first();await replay.waitFor();
    const [replayed]=await Promise.all([operations.waitForResponse(r=>r.url().endsWith("/replay")&&r.request().method()==="POST"),replay.click()]);
    const verified=await replayed.json();assert.equal(verified.ok,true);assert.equal(verified.data.replay.matched,true);checks.push({journey:"operations UI verifies stored run",passed:true});
    if(hosted){
      const planning=await json(faculty,"/api/bff/chapter11/overview");assert.equal(planning.body.ok,true);
      const selected=cohort.students.find((s,i)=>i>=36&&s.mentorId===cohort.students[studentIndex].mentorId&&i%4===0);assert.ok(selected);
      const policy=planning.body.data.policies.find(p=>p.faculty_person_id===person.faculty.id);assert.ok(policy);
      const created=await post(faculty,"/api/bff/chapter11/plans",{request:"Hosted acceptance: review scoped academic support evidence",studentIds:[selected.id],domain:"academic",policyId:policy.id,feedback:"Preserve unknown college source units and require mentor approval.",mode:"deterministic"});assert.equal(created.body.ok,true);
      const plan=created.body.data;
      const locked=await post(faculty,`/api/bff/chapter11/plans/${plan.id}/lock`,{expectedRevision:plan.revision});assert.equal(locked.body.ok,true);
      const ran=await post(faculty,`/api/bff/chapter11/plans/${plan.id}/execute`,{});assert.equal(ran.body.ok,true);assert.ok(ran.body.data.results.every(r=>!r.error));
      const exported=await json(faculty,`/api/bff/chapter11/plans/${plan.id}/export`);assert.equal(exported.body.ok,true);assert.equal(exported.body.data.jobs.length,1);
      const job=exported.body.data.jobs[0];assert.equal(job.status,"awaiting_faculty");assert.equal(job.stage,"complete");assert.ok(job.checkpoint.evidenceRevision);assert.deepEqual(Object.keys(job.checkpoint.evidence).sort(),["academic","internship","lms","placement"]);assert.equal(job.checkpoint.composed.validation.valid,true);
      const repeated=await post(faculty,`/api/bff/chapter11/plans/${plan.id}/execute`,{});assert.equal(repeated.body.ok,true);assert.equal(repeated.body.data.results.length,0);
      await writeFile(new URL("agent-execution-hosted.json",folder),JSON.stringify({status:"passed",planId:plan.id,jobId:job.id,sourceCount:4,evidenceRevision:job.checkpoint.evidenceRevision,mode:job.checkpoint.composed.mode,validation:job.checkpoint.composed.validation,statusBeforeMentorDecision:job.status,repeatCreatedJobs:0},null,2)+"\n",{mode:0o600});
      checks.push({journey:"hosted plan, lock, four-source collection, risk, validation, draft and duplicate execution",passed:true});
    }
    const urlBefore=hod.url();await Promise.all([hod.waitForResponse(r=>r.url().endsWith("/api/session/logout")&&r.request().method()==="POST"),hod.getByRole("button",{name:"Sign out",exact:true}).click()]);assert.notEqual(urlBefore,undefined);const loggedOut=await json(hod,"/api/bff/experience/overview");assert.equal(loggedOut.status,401);checks.push({journey:"logout invalidates portal session",passed:true});
  }
  assert.deepEqual(errors,[]);
  const result={status:"passed",hosted,studentIndex,checks,pageErrors:errors,institutionalAccountsClaimed:false,visualBaseline:"not established",screenReader:"not assessed"};
  await writeFile(new URL(process.argv.includes("--smoke")?"browser-smoke.json":process.argv.includes("--portals-only")?"browser-restart.json":"browser-acceptance.json",folder),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({status:result.status,checks:checks.length,actualProjectLogins:checks.filter(c=>c.actualProjectOidcLogin).length,pageErrors:errors.length}));
}catch(error){await writeFile(new URL("browser-failure.json",folder),JSON.stringify({portal:currentPortal,message:error.message.split("\nCall log:")[0],completedChecks:checks},null,2)+"\n",{mode:0o600});console.error(error.message.split("\nCall log:")[0]);process.exitCode=1;}finally{await Promise.all(Object.values(contexts).map(c=>c.close()));await browser.close();}
function pageDelay(ms){return new Promise(done=>setTimeout(done,ms));}
