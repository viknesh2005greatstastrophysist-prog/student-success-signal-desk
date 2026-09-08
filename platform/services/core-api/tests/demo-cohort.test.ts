import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { populateDemoCohort, demoCohortContext } from "../lib/populate-demo";
import { migrateCoreDatabase } from "../lib/migrations";
import { resetSyntheticSeed } from "../lib/reset";
import { withCoreTransaction, closePool } from "../lib/db";
import { experienceCommand } from "../lib/experience-commands";
import { experienceStudent } from "../lib/experience-queries";
import { lmsCourseDetail } from "../lib/lms-queries";
import { readSource } from "../lib/chapter11/service";

test("Additive demo cohort: three scoped mentors, populated records, durable edits and repeat-safe population", {skip:process.env.RUN_COHORT_DB_TESTS!=="1",timeout:600000}, async()=>{
  assert.match(process.env.CORE_DATABASE_SCHEMA ?? "",/^aura_core_test_cohort/);
  try {
    await migrateCoreDatabase();
    const seed=await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1","cohort-integration");
    const result=await populateDemoCohort(message=>console.log(message));
    assert.equal(result.generation,seed.generationId);
    assert.equal(result.students.length,10);
    assert.deepEqual(result.mentors.map(m=>m.students),[4,3,3]);
    assert.ok(result.students.every(s=>s.courses>0 && s.attendance_records>=8 && s.marks>=2 && s.followups===1 && s.invoices===1));
    assert.equal(result.reviews.length,10);
    assert.ok(result.reviews.every(r=>["awaiting_faculty","not_flagged"].includes(r.status)));
    assert.deepEqual(new Set(result.reviews.map(r=>r.band)),new Set(["low","medium","high"]));
    const ctx=await demoCohortContext();
    for(const [i,student] of ctx.students.entries()) {
      const profile=await experienceStudent(ctx.mentors[student.mentor]!.actor,student.studentId);
      assert.ok(profile);
      const source=await readSource(ctx.mentors[student.mentor]!.actor,student.studentId,"academic");
      assert.equal(source.state,"present");
      assert.equal(source.synthetic,true);
      await assert.rejects(()=>experienceStudent(ctx.mentors[(student.mentor+1)%3]!.actor,student.studentId));
      const lms=await readSource(ctx.mentors[student.mentor]!.actor,student.studentId,"lms");
      assert.equal(lms.state,"present");
      if([2,5].includes(i))assert.equal(lms.values.neverActive,true);
    }
    const responsible=ctx.courses.find(c=>c.code==="CS402")!;
    assert.equal((await lmsCourseDetail(ctx.mentors[1]!.actor,responsible.id)).canManage,true);
    await assert.rejects(()=>lmsCourseDetail(ctx.mentors[0]!.actor,responsible.id));
    const edit=await withCoreTransaction(async c=>(await c.query("SELECT * FROM support_followups WHERE student_id=$1",[ctx.students[1]!.studentId])).rows[0]);
    await experienceCommand(ctx.mentors[0]!.actor,randomUUID(),{action:"save-followup",id:edit.id,expectedRevision:edit.revision,studentId:edit.student_id,dueOn:"2026-09-20",note:"Keep this manually edited mentor note when population is repeated.",shared:true,status:"planned",outcome:"",reason:"Verify later mentor work is preserved"});
    const counts=()=>withCoreTransaction(async c=>(await c.query("SELECT (SELECT count(*) FROM domain_events)::int AS events,(SELECT count(*) FROM ch11_events)::int AS reviews,(SELECT count(*) FROM lms_activity)::int AS activity,(SELECT count(*) FROM people)::int AS people,(SELECT count(*) FROM simulation_resets)::int AS resets")).rows[0]);
    const before=await counts();
    assert.deepEqual(await populateDemoCohort(),result);
    assert.deepEqual(await counts(),before);
    const after=await withCoreTransaction(async c=>(await c.query("SELECT note,revision FROM support_followups WHERE id=$1",[edit.id])).rows[0]);
    assert.equal(after.revision,1);
    assert.match(after.note,/manually edited/);
    const historical=await withCoreTransaction(async c=>(await c.query("SELECT cr.grade_point FROM course_results cr JOIN registrations r ON r.student_id=cr.student_id AND r.course_offering_id=cr.course_offering_id WHERE r.status='completed' AND r.student_id=$1",[ctx.students[0]!.studentId])).rows[0]);
    assert.equal(Number(historical.grade_point),8);
    const identities = ["student10@aura.invalid","faculty3@aura.invalid","parent9@aura.invalid"];
    await withCoreTransaction(async c=>{
      for(const email of identities)await c.query("UPDATE people SET external_subject=$2 WHERE generation_id=$1 AND email=$3",[ctx.generation,`linked-${email}`,email]);
    });
    const refreshed=await resetSyntheticSeed("AURA-SYNTHETIC-SEED-V1","verify-identity-preservation");
    const subjects=await withCoreTransaction(async c=>(await c.query("SELECT email,external_subject FROM people WHERE generation_id=$1 AND email=ANY($2::text[])",[refreshed.generationId,identities])).rows);
    assert.equal(subjects.length,3);
    assert.ok(subjects.every(p=>p.external_subject===`linked-${p.email}`));
  }finally{await closePool();}
});
