> Current scope: the private project edition uses supplied sources plus generated operations. See [Final project report](FINAL_PROJECT_REPORT.md) and [Runbook](PROJECT_RUNBOOK.md). Requirements for verified institutional rollout below remain separate.

# Dataset integration checkpoint

Updated 12 October 2026. Active implementation:
`student-success-multi-portal/platform`. The case-manager repository and
root-level Python/single-portal implementation are historical references.

## Completed

- Reviewed current portal specification, rebuild progress, Chapter 11 ledger,
  submission requirements and attendance importer/source-review implementation.
- Discovered all attendance-named XLS files in Downloads: twelve copies,
  six unique workbooks. The five existing full-attendance reports are unchanged.
- Added `scripts/import-college-reports.py` for complete discovery/deduplication,
  independently verified CIE parsing, separate course legend/footer, stable SRN
  identity reuse, inventory and raw attendance comparison.
- Added `platform/services/core-api/lib/chapter11/college-cie.ts` to validate
  fields, source-cell scope, totals and identity-map matches. Extended the private
  review loader/UI for CIE without changing the hosted portals or database.
- Imported six workbooks into ignored `runtime/college-attendance/2026-10-12/`:
  321 students, 328 attendance rows, 67 matching CIE rows, 7,265 recorded values.
  All original files and source-cell references remain preserved. Both readers
  agreed across 10,287 workbook cells including headers and legends.
- Recorded the user's local-use instruction verbatim in dataset/source-matched
  private context files. The user confirmed that meanings and dates are unknown.

## Verification

Initial parser and source validation passed after correcting the CIE count schema
to allow absent zero-count categories. The browser check was corrected to handle
a student appearing in three report cards and to use an explicit browser context
for Axe. Neither failed attempt counts as a pass.

Final verification evidence is stored privately under the import directory:
`final-checks.json`, `browser-verification.json`, command logs and redacted
screenshots. Ten Python parser tests and 33 Core tests passed. Five opt-in
database suites were skipped; no database test or database integration is
claimed. Core lint/type checks, repeat-import identity/value stability and
preserved-original hash checks passed. The browser checks cover totals, CIE details and provenance,
course titles, search, no results, clearing filters, pagination and 375/768/1440px
layouts. Baseline visual regression and a screen-reader review are not established.
No production release verification was performed in this session.

## Remaining work for complete real-case acceptance

1. Obtain academic year/reporting periods and source definitions for units,
   zero, NA, TNS, dash, maximum CIE marks and eligibility rules. Do not infer them
   from report-generation timestamps or plausible interpretations.
2. Obtain actual mentor mappings and authorized LMS records. Career sources
   need evidence or explicit non-applicability. The CIE internship course title
   is not proof of internship milestones or placement activity.
3. Connect validated real sources to an isolated private workflow with actual
   mappings. Never assign actual students to fictional public demo identities.
4. Exercise data-quality blocks, source conflicts, citations, mentor edits and
   approval, student/parent scoping where real relationships exist, persistence,
   publication withdrawal/restoration and audit export for that exact dataset.
5. Obtain actual faculty acceptance of the real case, or explicit acceptance of
   the synthetic substitute. Refresh submission artifacts and release evidence
   only for verified outcomes and approved content.

The documented September synthetic acceptance is historical evidence. It does
not establish current hosted availability or satisfy actual mentor sign-off.
Attendance/CIE import and private review are implemented; the full real-data
institutional rollout is not marked complete. The subsequent implementation
below supersedes items 3 and the local-workflow portion of item 4.

## Subsequent implementation: all six portals and private agents

The owner selected real college users across all six portals. Added:

- A durable private SQLite coordinator: frozen plans/source snapshots, bounded
  workers, checkpoint recovery, model repair/fallback, local edits, follow-ups,
  exact-version checklist acceptance, withdrawal/restore and hash-chained replay.
- Prepared all 321 actual students with two shared model profiles and two actual
  local model calls. Model input contains only predefined question codes and
  descriptions. Actual mentor approvals and real user logins verified: zero.
  Risk remains null; publication is blocked. Current dataset digest starts
  `30b9503c768fc624`. This run binds loaded identities/source contents, correcting
  an earlier overly narrow digest; historical local runs remain in audit history.
- Authenticated `/college-records` and BFF routes across all six portals, with a
  private Core source vault. Live mentor assignments and parent field grants
  constrain immutable access mappings; governance receives aggregate readiness.
- Opt-in institutional email sign-in, verified-email requirement, demo sign-in
  rejection, and guards against synthetic reset/population, simulated payments
  and legacy demo-policy execution in real-data schemas.
- Strict approved four-source normalization with declared dates/term, per-student
  mentor approval, finite measurements and no freeform model context. Current
  unknown-filled templates fail validation without writing to the database.
- Prefilled private intake files plus `WHAT_I_NEED_FROM_YOU.md` and
  `REAL_COLLEGE_ROLLOUT.md`. Existing intake answers are preserved on regeneration.

Release-check findings were addressed: accessible keyboard scrolling for the
new mobile source table; framework and production transitive dependency updates.
The production dependency audit is recorded separately from development-only
lint-toolchain findings. Earlier failed checks do not count as passes.

Final verification results are recorded in private `real-college-final-verification.json`
and the source-safe `REAL_COLLEGE_VERIFICATION.md`. Native rendering uses fictional
intercepted data; actual real-user login is not claimed. PostgreSQL integration
uses disposable fictional test schemas, not actual student records. No hosted
services were changed and no real data was uploaded.

## Resume

Read `COLLEGE_ATTENDANCE_IMPORT.md` and inspect the ignored import inventory.
The review command is `cd platform && npm run attendance:review --
../runtime/college-attendance/2026-10-12/attendance.json 3502`. Tests use fictional
identities only. Existing attendance work was already uncommitted at session
start; new CIE work is also local. The September archive excludes these additions
and all private student data.

The agent workflow is `npm run attendance:workflow --
../runtime/college-attendance/2026-10-12/attendance.json 3503` from `platform/`.
Next external input: the authorized college directory, definitions and methodology
listed in `WHAT_I_NEED_FROM_YOU.md`. Local changes remain uncommitted.
