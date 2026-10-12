import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { collegeAttendanceSchema, reviewCollegeAttendance } from "../lib/chapter11/college-attendance";

import { fixture } from "./fixtures/college-attendance";

test("college import preserves zero, NA, TNS and separate lab batches", () => {
  const data = collegeAttendanceSchema.parse(fixture());
  assert.deepEqual(data.observations.map(o => [o.numericValue,o.sourceStatus]), [[0,null],[null,"NA"],[null,"TNS"],[79,null]]);
  assert.notEqual(data.observations[1]!.courseKey,data.observations[2]!.courseKey);
});
test("freshly imported but undated attendance cannot become an overall risk score", () => {
  const review = reviewCollegeAttendance(fixture());
  assert.equal(review.fullAgentReviewReady,false);
  assert.equal(review.overallRiskScore,null);
  assert.equal(review.students[0]!.overallAttendancePct,null);
  assert.equal(review.sources[0]!.collectionDateIsReportingDate,false);
  assert.ok(review.missingInputs.includes("marks"));
  assert.ok(review.missingInputs.includes("LMS activity"));
});
test("reject a status silently converted into zero", () => {
  const data=fixture();data.observations[1]!.numericValue=0;
  assert.throws(()=>collegeAttendanceSchema.parse(data),/NA\/TNS cannot be converted/);
});
test("reject a record attached to the wrong student, semester or source cell", () => {
  for(const field of ["studentId","semester","sourceCell"] as const) {
    const data=fixture();
    Object.assign(data.observations[0]!, {[field]:field==="studentId"?"22222222-2222-4222-8222-222222222222":field==="semester"?8:"G19"});
    assert.throws(()=>collegeAttendanceSchema.parse(data),/scope|source row/);
  }
});
test("reject duplicate report contents, source cells and incomplete student rows", () => {
  const source=fixture();source.sources.push({...source.sources[0]!});
  assert.throws(()=>collegeAttendanceSchema.parse(source),/Duplicate source/);
  const cell=fixture();cell.observations.push({...cell.observations[0]!});
  assert.throws(()=>collegeAttendanceSchema.parse(cell),/Duplicate source|Duplicate course/);
  const missing=fixture();missing.observations.pop();
  assert.throws(()=>collegeAttendanceSchema.parse(missing),/Missing course/);
});
test("reject invented percentages, class counts, synthetic flags and wrong totals", () => {
  for(const alteration of [{attendancePct:79},{heldClasses:100},{synthetic:true}]) {
    const data=fixture();Object.assign(data.observations[0]!,alteration);
    assert.equal(collegeAttendanceSchema.safeParse(data).success,false);
  }
  const data=fixture();data.summary.uniqueStudents=2;
  assert.throws(()=>collegeAttendanceSchema.parse(data),/summary mismatch/);
});
test("one student can have distinct semester records without merging attendance", () => {
  const data=fixture(), sourceId="a".repeat(64),enrollmentId="b".repeat(64);
  data.sources.push({...data.sources[0]!,id:sourceId,sha256:sourceId,semester:8});
  data.enrollments.push({...data.enrollments[0]!,id:enrollmentId,sourceId,semester:8});
  data.observations.push(...data.observations.map((o,i)=>({...o,id:createHash("sha256").update(`second-${i}`).digest("hex"),sourceId,enrollmentId,semester:8})));
  Object.assign(data.summary,{sourceFiles:2,studentRows:2,studentsInMultipleReports:1,attendanceCells:8,numericCells:4,zeroCells:2,naCells:2,tnsCells:2,verifiedSourceCells:128});
  const review=reviewCollegeAttendance(data);
  assert.equal(review.students.length,1);
  assert.equal(review.students[0]!.records.length,8);
  assert.deepEqual([...new Set(review.students[0]!.records.map(r=>r.semester))],[4,8]);
  assert.equal(review.students[0]!.overallAttendancePct,null);
});
