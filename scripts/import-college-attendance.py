#!/usr/bin/env python3
"""Read college XLS snapshots into private, traceable attendance records.

No database writes, network calls, inferred absences, or invented class sessions.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import uuid

import xlrd
from python_calamine import CalamineWorkbook

PROJECT = Path(__file__).resolve().parents[1]
HEADERS = ["Sl No", "Student Name", "SRN No.", "Roll No"]


def text(value):
    return " ".join(str(value).split())


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    tmp.chmod(0o600)
    tmp.replace(path)


def classify(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value) or value < 0 or value > 100:
            raise ValueError("Attendance number outside the source's 0-100 range")
        return "number", float(value), None
    token = text(value).upper()
    if token in ("NA", "TNS"):
        return "source_status", None, token
    if token == "":
        return "blank", None, None
    raise ValueError("Unknown attendance cell value; review the source before importing")


def read_verified(path):
    recovery = False
    try:
        book = xlrd.open_workbook(path, logfile=io.StringIO())
    except xlrd.compdoc.CompDocError:
        # Some college exports have invalid OLE sector bookkeeping. Recovery is
        # acceptable only if a second independent reader agrees on every cell.
        recovery = True
        book = xlrd.open_workbook(path, ignore_workbook_corruption=True, logfile=io.StringIO())
    other = CalamineWorkbook.from_path(str(path))
    if book.sheet_names() != other.sheet_names:
        raise ValueError("Independent readers disagree about sheet names")
    verified = 0
    for index, sheet in enumerate(book.sheets()):
        second = other.get_sheet_by_index(index).to_python()
        if len(second) != sheet.nrows or any(len(row) != sheet.ncols for row in second):
            raise ValueError("Independent readers disagree about sheet dimensions")
        for row in range(sheet.nrows):
            for col in range(sheet.ncols):
                if sheet.cell_value(row, col) != second[row][col]:
                    raise ValueError(f"Independent readers disagree at {sheet.name}!{xlrd.formula.colname(col)}{row+1}")
                verified += 1
    return book, recovery, verified


def parse_report(path, identity_map):
    book, recovery, verified = read_verified(path)
    if book.nsheets != 1:
        raise ValueError("Expected one Full_Attendance sheet")
    sheet = book.sheet_by_index(0)
    if sheet.name != "Full_Attendance" or sheet.nrows < 8 or sheet.ncols < 5:
        raise ValueError("Unsupported attendance report layout")
    if [text(v) for v in sheet.row_values(6)[:4]] != HEADERS:
        raise ValueError("Attendance report headers changed")
    if text(sheet.cell_value(3, 0)) != "FULL ATTENDANCE REPORT":
        raise ValueError("Not a full attendance report")
    for row, col, expected in [(4,0,"Stream & Department:"),(4,4,"Semester:"),(5,0,"Section:"),(5,4,"Date Range:")]:
        if text(sheet.cell_value(row,col)) != expected:
            raise ValueError("Report metadata labels changed")
    semester_match = re.fullmatch(r"Semester (\d+)", text(sheet.cell_value(4,5)))
    if not semester_match:
        raise ValueError("Missing semester label")
    source_id = checksum(path.read_bytes())
    semester = int(semester_match[1])
    section = text(sheet.cell_value(5,1))
    headers = [text(sheet.cell_value(6,c)) for c in range(4,sheet.ncols)]
    if any(not h for h in headers) or len({h.upper() for h in headers}) != len(headers):
        raise ValueError("Missing or duplicate course/batch columns")
    source = {
        "id": source_id, "filename": path.name, "sha256": source_id,
        "sheet": sheet.name, "institution": text(sheet.cell_value(1,0)),
        "department": text(sheet.cell_value(4,1)), "semester": semester,
        "section": section, "reportedDateRange": text(sheet.cell_value(5,5)),
        "periodStart": None, "periodEnd": None, "academicTerm": None,
        "numericUnit": "unconfirmed_0_to_100", "statusDefinitions": {"NA": None,"TNS": None},
        "parserRecoveryRequired": recovery, "independentReadersAgree": True,
        "verifiedCells": verified, "courseColumns": headers, "studentRows": 0,
    }
    observations, enrollments, private_rows = [], [], []
    seen = set()
    for r in range(7,sheet.nrows):
        values = sheet.row_values(r)
        if not any(v != "" for v in values):
            continue
        srn = text(values[2]).upper()
        name = text(values[1])
        if not re.fullmatch(r"[A-Z0-9]{5,40}", srn) or not name or not isinstance(values[0],(int,float)):
            raise ValueError(f"Invalid student identity or row at {sheet.name}!A{r+1}:D{r+1}")
        if srn in seen:
            raise ValueError(f"Duplicate SRN within one report at row {r+1}")
        seen.add(srn)
        if srn not in identity_map:
            identity_map[srn] = {"studentId": str(uuid.uuid4()), "displayId": f"Student {len(identity_map)+1:03d}"}
        identity = identity_map[srn]
        enrollment_id = checksum(f"{source_id}:{sheet.name}:{r+1}".encode())
        enrollment = {"id": enrollment_id, "studentId": identity["studentId"],
                      "displayId": identity["displayId"], "sourceId": source_id,
                      "semester": semester, "section": section, "sourceRow": r+1}
        enrollments.append(enrollment)
        private_rows.append({**enrollment, "studentName": name,"originalStudentName": values[1],
                             "srn": srn,"originalSrn": values[2],"rollNumber": values[3],"serialNumber":values[0]})
        for col, course in enumerate(headers,4):
            value = values[col]
            kind, numeric, code = classify(value)
            cell = f"{xlrd.formula.colname(col)}{r+1}"
            observations.append({"id":checksum(f"{source_id}:{sheet.name}:{cell}".encode()),
                "studentId":identity["studentId"],"enrollmentId":enrollment_id,
                "sourceId":source_id,"sourceCell":cell,"courseLabel":course,
                "courseKey":course.upper(),"semester":semester,"section":section,
                "kind":kind,"rawValue":value,"numericValue":numeric,"sourceStatus":code,
                "attendancePct":None,"attendedClasses":None,"heldClasses":None,
                "synthetic":False})
    source["studentRows"] = len(enrollments)
    return source, enrollments, observations, private_rows


def ingest(paths, output):
    output = output.resolve()
    private_root = (PROJECT / "runtime" / "college-attendance").resolve()
    if output != private_root and private_root not in output.parents:
        raise ValueError("Output must stay under this project's ignored runtime/college-attendance directory")
    if len({p.resolve() for p in paths}) != len(paths):
        raise ValueError("The same source path was supplied twice")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    identity_path = output / "private-identity-map.json"
    identity_map = json.loads(identity_path.read_text()) if identity_path.exists() else {}
    sources, enrollments, observations, private_rows = [], [], [], []
    for path in paths:
        source, rows, cells, people = parse_report(path, identity_map)
        if source["id"] in {s["id"] for s in sources}:
            raise ValueError("Duplicate source contents under different filenames")
        sources.append(source);enrollments.extend(rows);observations.extend(cells);private_rows.extend(people)
    dataset_id = checksum("\n".join(sorted(s["id"] for s in sources)).encode())
    appearances = defaultdict(list)
    for row in enrollments:
        appearances[row["studentId"]].append(row)
    counts = Counter(o["sourceStatus"] or o["kind"] for o in observations)
    summary = {"sourceFiles":len(sources),"studentRows":len(enrollments),"uniqueStudents":len(appearances),
        "studentsInMultipleReports":sum(len(rows)>1 for rows in appearances.values()),
        "attendanceCells":len(observations),"numericCells":counts["number"],
        "zeroCells":sum(o["kind"]=="number" and o["numericValue"]==0 for o in observations),
        "naCells":counts["NA"],"tnsCells":counts["TNS"],"blankCells":counts["blank"],
        "verifiedSourceCells":sum(s["verifiedCells"] for s in sources),
        "parserRecoveryFiles":sum(s["parserRecoveryRequired"] for s in sources)}
    payload = {"schemaVersion":"aura.college-attendance.v1","datasetId":dataset_id,
        "importedAt":datetime.now(timezone.utc).isoformat(),"sourceType":"user_supplied_college_export",
        "privacy":"private_local_pseudonymized","synthetic":False,
        "summary":summary,"sources":sources,"enrollments":enrollments,"observations":observations}
    # Write only after all files pass both readers and structural checks.
    for path, source in zip(paths,sources):
        dest = output / "originals" / f"{source['id'][:16]}-{path.name}"
        dest.parent.mkdir(mode=0o700,exist_ok=True)
        if dest.exists() and checksum(dest.read_bytes()) != source["sha256"]:
            raise ValueError("A preserved original has changed")
        if not dest.exists():
            shutil.copyfile(path,dest);dest.chmod(0o600)
    write_private(identity_path,identity_map)
    write_private(output/"private-student-records.json",private_rows)
    write_private(output/"attendance.json",payload)
    issues = {
        "datasetId":dataset_id,"summary":summary,
        "status":"imported_for_source_review","liveDatabaseModified":False,
        "fullAgentReviewReady":False,
        "questions":["Confirm the academic term and reporting dates; all current exports say 0 to 0.",
          "Confirm whether numeric cells are attendance percentages; the cells use General format.",
          "Define NA and TNS without treating them as numeric zero.",
          "Confirm whether recorded zeroes are actual attendance results or unstarted/unrecorded classes.",
          "Provide course names, class counts, mentor assignments and any other real evidence separately."],
        "crossReportStudents":[{"displayId":rows[0]["displayId"],"rows":[{"sourceId":r["sourceId"],"row":r["sourceRow"],"semester":r["semester"],"section":r["section"]} for r in rows]} for rows in appearances.values() if len(rows)>1],
    }
    write_private(output/"quality-review.json",issues)
    lines=["# College attendance import", "", "Private local source review. No live portal or database was changed.", "",
      f"{summary['studentRows']} report rows represent {summary['uniqueStudents']} unique students. {summary['studentsInMultipleReports']} students occur in multiple reports.","",
      "| Report | Semester | Section | Rows |", "| --- | --- | --- | --- |"]
    lines += [f"| {s['filename']} | {s['semester']} | {s['section']} | {s['studentRows']} |" for s in sources]
    lines += ["",f"{summary['attendanceCells']} attendance cells: {summary['numericCells']} numeric values, {summary['naCells']} NA, {summary['tnsCells']} TNS, and {summary['blankCells']} blanks. {summary['zeroCells']} numeric values are zero.","",
      f"Two independent readers matched all {summary['verifiedSourceCells']} source cells. {summary['parserRecoveryFiles']} exports needed OLE-container recovery in one reader; the original files were not changed.","",
      "## Confirm before using attendance to flag students",""] + [f"- {q}" for q in issues["questions"]]
    lines += ["","## What the import preserves","",
      "Every value keeps its source file hash, sheet and cell. Student identity is matched by SRN in a separate private map. Semester records and lab batches remain separate. Repeating the same import keeps the same student and observation IDs.","",
      "These are summary values, not dated present/absent entries. No class history, average attendance, marks, GPA, LMS activity, faculty assignment, fees or family links were invented. The project cannot run a complete four-source review from attendance alone.","",
      "The dated folder is the import date, not the academic reporting period. Coded IDs reduce direct identifiers; this remains student data. Usage permission and source clarifications are kept separately in source-context.json when provided.",""]
    report = output/"IMPORT_REVIEW.md";report.write_text("\n".join(lines));report.chmod(0o600)
    return summary


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports",nargs="+",type=Path)
    parser.add_argument("--output",type=Path,default=PROJECT/"runtime/college-attendance/2026-09-09")
    args=parser.parse_args()
    os.umask(0o077)
    print(json.dumps(ingest(args.reports,args.output),indent=2))
