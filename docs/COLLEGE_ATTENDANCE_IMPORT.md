# Using college attendance reports

## 12 October 2026: all Downloads reports

The project owner instructed local use of all attendance reports in Downloads,
and answered **unknown** for the academic year, reporting dates and meanings of
zero, NA and TNS. Local-use authorization is recorded verbatim for this import;
it is not new evidence of institutional approval or permission to publish data.

The files are XLS, not CSV. Twelve filenames contain six unique workbooks:
five Full_Attendance reports and one FINAL CIE & ATTENDANCE report. The five
attendance workbooks have the same hashes as the earlier import. Duplicate
copies are inventoried by filename and SHA-256, then imported once.

The combined import contains 321 distinct students, 328 full-attendance rows
and 67 CIE rows. All CIE USNs exactly match existing SRNs. There are 5,188
attendance values and 2,077 CIE-report fields, totaling 7,265 recorded values.
The CIE numeric fields include 150 CIE totals and five each of CIE Theory and
CIE Lab. These are raw marks, not normalized percentages. Maximum marks remain
unknown. Its nine-course legend supplies titles and credits, retained separately
from student rows. Recorded Yes/No eligibility tokens are source statements,
not an independently validated eligibility decision.

The CIE footer says the report was generated on 27 September 2026. It does not
establish the academic year or attendance period. Source scope labels are
preserved, including the different department labels in the two report layouts.
No course or department mapping to the synthetic demo is inferred.

Reproduce the import from the repository root:

```sh
runtime/attendance-tools/bin/python scripts/import-college-reports.py /Users/vik/Downloads \
  --output runtime/college-attendance/2026-10-12 \
  --previous runtime/college-attendance/2026-09-09
```

This writes the existing attendance format plus private `cie.json` and
`download-inventory.json`. It reuses the prior SRN identity map. Each workbook
is checked cell-by-cell by the same independent readers. A raw comparison
retains any differences rather than selecting a winner: 83 pairs of numeric
attendance values agree; 520 pairs include a status or missing value and remain
incomparable. Reporting periods are unconfirmed, and the sources remain separate.

The combined screen requires source-matched `source-context.json` for attendance
and `cie-source-context.json` for CIE, using the existing context schema. Each
must record the actual authorization statement and unknown definitions. CIE
context uses the CIE source SHA-256 as its dataset ID. The loader also verifies
every CIE row against the private SRN map. Reimporting unchanged sources keeps
these context files; changed sources require corresponding authorization context.

```sh
cd platform
npm run attendance:review -- ../runtime/college-attendance/2026-10-12/attendance.json 3502
# In another terminal, with the review running:
node scripts/verify-college-review.mjs http://127.0.0.1:3502 ../runtime/college-attendance/2026-10-12
```

Open `http://127.0.0.1:3502`. Search by name/SRN or filter by report. Student
details show full attendance and CIE as separate tables, each with source cells.
CIE Theory/Lab and Attendance Theory/Lab stay separate. Dash, zero, blank, NA,
TNS and eligibility tokens are never silently converted into one another.
Course titles/credits are available behind a details control.

Private data, originals, inventory, validation logs and masked screenshots are
under `runtime/college-attendance/2026-10-12/`. The hosted synthetic portals and
the September submission archive are unchanged. Current checks and remaining
completion work are in `DATASET_INTEGRATION_PROGRESS.md`.

The sections below describe the earlier attendance-only import.

The project now has a local importer for the supplied `Full_Attendance` XLS report format. These files are a source of truth for what the college export records. They do not independently prove that every entry is correct or that a mentor has accepted a case.

The import is deliberately separate from the public password-free synthetic demo. Real names, SRNs, original files and derived student records stay in `runtime/college-attendance/`, which Git ignores. Nothing here connects to the college system, sends data to a model, changes the hosted database or enters the shared submission archive.

## What is preserved

- Original report bytes and SHA-256 hashes.
- Student identity matched by SRN in a private identity map. Coded IDs in the project-facing bundle.
- Separate semester, section and course/batch records, including a student appearing in multiple reports.
- Each source value, with its source hash, sheet, row and cell.
- Numeric zero, `NA`, `TNS` and blank as distinct values.

The importer checks every cell with both xlrd and Calamine. Some exports have malformed OLE container bookkeeping. An xlrd recovery read is accepted only if Calamine independently reads exactly the same sheet dimensions and every cell. Structural changes, unknown attendance tokens, invalid identities and duplicated source files stop the import. A repeat import into the same directory keeps identity and observation IDs stable.

## Run locally

From the repository root, create a dedicated environment and install the parser dependencies:

```sh
python3 -m venv runtime/attendance-tools
runtime/attendance-tools/bin/python -m pip install -r scripts/attendance-requirements.txt
runtime/attendance-tools/bin/python scripts/import-college-attendance.py /path/to/report.xls --output runtime/college-attendance/your-import
```

Pass all related files together before `--output`. The importer accepts outputs only under the ignored private directory. It stores originals, `attendance.json`, a private identity map, private named rows, `quality-review.json` and `IMPORT_REVIEW.md`.

The project's Chapter 11 source-review adapter validates the bundle and prepares each student's course observations:

```sh
cd platform
node --import tsx services/core-api/scripts/review-college-attendance.ts ../runtime/college-attendance/your-import/attendance.json
```

This creates a private `project-source-review.json`. It validates student/source/semester scope, source-cell references, complete course coverage and independent count totals. It does not invent an overall attendance rate or a risk score.

Run the parser and adapter checks:

```sh
runtime/attendance-tools/bin/python scripts/test-college-attendance.py
cd platform
node --import tsx --test services/core-api/tests/college-attendance.test.ts
```

## Open the local review screen

On 9 September 2026, the project owner confirmed that the college has given permission to use these records. That confirmation is recorded as a user statement in the private import's `source-context.json`. The owner did not know the units, dates or status definitions. The suggestion that zero probably means no attendance remains an unconfirmed hypothesis.

From `platform`, open the named, read-only source review:

```sh
npm run attendance:review -- ../runtime/college-attendance/2026-09-09/attendance.json
```

Open `http://127.0.0.1:3501`. Choose a semester and section, search by name or SRN, then select **View record**. Students with several reports have separate semester tables. Every value shows its original course/batch and spreadsheet cell. **Back to students** retains the search and page. This screen does not compute percentages, risk scores or attendance averages.

The server binds only to `127.0.0.1`, rejects foreign hosts and cross-site requests, disables caching, and has no write routes. It serves only the review and its fixed assets. It does not require the demo database or identity service. Keep it running while reviewing; press Ctrl+C to stop. Pass a different port after the JSON path if needed.

The loader requires a dataset-matched `source-context.json` using `aura.college-source-context.v1`, with `permission` (`status: user_confirmed`, `confirmedOn`, the actual `statement`, `basis: user_statement`) and `clarification` (`zeroMeaning: unconfirmed`, a `zeroHypothesis`, and null `naMeaning`, `tnsMeaning`, `numericUnit`, `academicTerm`, `periodStart`, `periodEnd`). Do not copy permission between unrelated imports. Reimporting the same source files preserves this separate context file; changed source files require a new dataset-matched record.

The review is a local project tool. The hosted role portals still use the fictional cohort. No college records are assigned to fictional mentors or parent accounts.

## Confirm before a mentor review

The supplied exports say `Date Range: 0 to 0`. Their numbers use General cell formatting, and the files have no legend defining `NA`, `TNS` or zero. Obtain the reporting period, unit and status meanings from the college/source owner before treating the numbers as current attendance percentages. File creation/import dates do not establish academic dates.

These are aggregate course values. Class counts and dated attendance entries are absent. Do not reconstruct present/absent sessions, average percentages across courses with unknown denominators, or claim that a summary row completes course registration. Course codes are not course titles. A lab batch column is not a mentor assignment.

Marks, LMS activity, mentor assignments, parent links, fees and the other career evidence are not supplied by these reports. The current full Chapter 11 workflow requires more than attendance. Missing real evidence must stay missing, rather than borrowing a fictional student's records or producing a false low-risk result.

Permission to use the supplied data has been confirmed by the project owner. Once source meanings are established, connect the validated import to a portal dataset with actual mentor mappings and reporting periods. The remaining source questions concern what the data means. Until those are resolved, the supported endpoint is local source review. The public six-portal demo continues to use its fictional cohort.

Coded IDs are pseudonyms, not proof of anonymization. Course and attendance patterns may still identify a student. Do not publish the derived bundle by assuming that removing names makes it public data.

## Verification on 9 September 2026

All five supplied reports loaded into the local named review: 321 distinct students, 328 report rows and 5,188 recorded course values. The 12 TypeScript importer/review tests and four Python parser tests passed. Core API typechecking and lint passed. The tests cover identity mismatches, separate semester records, unconfirmed source meanings, path/symlink boundaries and read-only HTTP access.

The browser walkthrough checked SRN search, a student appearing in two semesters, returning to the filtered list, no-result search, clearing a search, pagination and semester/section filtering. The layout was inspected at desktop size and a 390-pixel viewport, with no page-level horizontal overflow at the narrow size. No browser console errors were reported. These checks establish local source review, not a hosted deployment or a complete mentor review.
