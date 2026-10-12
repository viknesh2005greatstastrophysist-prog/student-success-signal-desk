import { createHash } from "node:crypto";

// Fictional fixtures only. Never commit actual student rows for an import test.
export function fixture() {
  const h = (s: string) => createHash("sha256").update(s).digest("hex");
  const sourceId = h("fictional source"), studentId = "11111111-1111-4111-8111-111111111111", enrollmentId = h("enrollment");
  const values = [0,"NA","TNS",79] as const;
  const courseColumns = ["TEST101", "TEST102 Batch 1", "TEST102 Batch 2", "TEST103"];
  return {
    schemaVersion: "aura.college-attendance.v1", datasetId: h(sourceId), importedAt: "2026-09-09T12:00:00+00:00",
    sourceType: "user_supplied_college_export", privacy: "private_local_pseudonymized", synthetic: false,
    summary: {sourceFiles:1,studentRows:1,uniqueStudents:1,studentsInMultipleReports:0,attendanceCells:4,
      numericCells:2,zeroCells:1,naCells:1,tnsCells:1,blankCells:0,verifiedSourceCells:64,parserRecoveryFiles:0},
    sources: [{id:sourceId,filename:"FICTIONAL_TEST.xls",sha256:sourceId,sheet:"Full_Attendance",institution:"Example College",
      department:"Example Department",semester:4,section:"Section A",reportedDateRange:"0 to 0",periodStart:null,periodEnd:null,
      academicTerm:null,numericUnit:"unconfirmed_0_to_100",statusDefinitions:{NA:null,TNS:null},
      parserRecoveryRequired:false,independentReadersAgree:true,verifiedCells:64,courseColumns,studentRows:1}],
    enrollments: [{id:enrollmentId,studentId,displayId:"Student 001",sourceId,semester:4,section:"Section A",sourceRow:8}],
    observations: values.map((rawValue,index) => ({id:h(`cell-${index}`),studentId,enrollmentId,sourceId,
      sourceCell:`${String.fromCharCode(69+index)}8`,courseLabel:courseColumns[index]!,courseKey:courseColumns[index]!.toUpperCase(),
      semester:4,section:"Section A",kind:typeof rawValue==="number"?"number":"source_status",rawValue,
      numericValue:typeof rawValue==="number"?rawValue:null,sourceStatus:typeof rawValue==="string"?rawValue:null,
      attendancePct:null,attendedClasses:null,heldClasses:null,synthetic:false})),
  };
}

