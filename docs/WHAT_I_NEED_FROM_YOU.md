> Current scope: the private project edition uses supplied sources plus generated operations. See [Final project report](FINAL_PROJECT_REPORT.md) and [Runbook](PROJECT_RUNBOOK.md). Requirements for verified institutional rollout below remain separate.

# Inputs needed to finish the real-college rollout

Target confirmed on 12 October 2026: real college users across Student, Parent,
Faculty/Mentor, HoD, Governance/AI Activity and LMS portals.

The imported records are usable as raw evidence now. They are insufficient to
create verified accounts, establish parent relationships, calculate attendance
percentages or approve interventions. Unknowns remain unknown.

## 1. A college coordinator and source definitions

Provide the name and official email of the person authorized to confirm data
access, account mappings and source meanings, with a written approval reference.
For each of the six exports, obtain:

- Academic year, term, start date and end date covered.
- What the numeric attendance fields measure: counts, percentages or another unit.
- The meanings of `0`, `NA`, `TNS`, dash and blank. Distinguish zero marks from
  missing marks if the college does so.
- Maximum CIE marks by course/component, theory/lab weighting and aggregation.
- Official attendance, assessment and examination eligibility rules.

A report-generation date does not answer the reporting-period question. If the
college cannot confirm a value, leave it unknown. Its dependent calculation stays
blocked; raw-record review can still proceed.

## 2. The official account directory and relationships

The student sheet already contains all 321 imported names and SRNs. Supply verified
account emails, department, cohort year, current semester and assigned mentor.
For staff, supply names, official emails, department and roles: faculty/mentor,
HoD and the authorized AI operator. Specify teaching assignments separately.
For parents, supply verified emails, linked students, relationship verification
and the exact fields they may see. A surname match is not relationship evidence.

**Do not send passwords.** Internal account IDs and OIDC subjects can be generated
or matched during provisioning. You do not need to invent them or retype the
student list. One student login can access Student and LMS according to its
permissions; six portals do not require six accounts per person.

## 3. Academic operations data

Supply the official course catalogue, course IDs, credits, term IDs, faculty
assignments, current registrations, timetable and the approved grading scale.
Provide published results and historical terms if SGPA/CGPA is expected.
Attendance exports alone cannot populate these operations reliably.

## 4. LMS and career evidence

Supply course enrolments, published lessons, assignment deadlines, submissions,
feedback and activity timestamps, or nominate the college LMS/API that supplies
them. Provide internship milestones and placement activity, or have an authorized
source owner explicitly confirm non-applicability for each affected student.
An internship course title does not establish internship participation.

If actual fees are in scope, provide the fee ledger. If live payments are required,
also choose the approved payment provider and receipt/reconciliation process.
Simulated demo payments are disabled in institutional mode.

## 5. Mentor policy and acceptance

A real mentor must approve the thresholds, source freshness, aggregation rules,
support action catalogue and rationale. Each student's normalized evidence must
be approved by their assigned mentor. Then the college must exercise actual
review, correction, approval, student/parent visibility and withdrawal with its
own accounts. Local checklist acceptance is not this institutional sign-off.

## 6. Login and deployment decisions

Confirm the account method: college SSO or provisioned, verified email accounts.
SSO requires provider details and an integration; managed accounts require a
verification/reset email service and an invitation process. Specify approved
hosting, private portal URLs, data access/retention rules and the operational owner.
Provide service access through the appropriate secure setup, not in a spreadsheet.
The current institutional sign-in implementation uses managed email/password
accounts; SSO is not claimed as implemented.

## Prepared files

The private intake folder is:
`runtime/college-attendance/2026-10-12/intake/`.

| File | College information needed |
|---|---|
| `source-definitions.json` | Dates, units, status meanings, marks and rules |
| `student-accounts-and-mentors.csv` | Verified emails, departments, cohort, semester and mentors |
| `staff-and-parent-accounts.csv` | Roles, relationships and field permissions |
| `course-and-teaching-map.csv` | Official courses, credits and faculty assignments |
| `registrations-and-timetable.csv` | Actual enrolments and scheduled classes |
| `lms-activity.csv` | Linked, timestamped learning evidence |
| `career-evidence.csv` | Internship/placement evidence or confirmed non-applicability |
| `approved-policy.json` | Mentor-approved methodology |
| `fee-records-if-in-scope.csv` | Actual ledger, only if fees are in scope |

The access mapping and normalization templates are technical handoff files.
Codex can complete their internal IDs from the verified directory and approved
definitions. A `true` flag or approval reference is an attestation, not independent
proof; it must correspond to actual college evidence.

After these inputs arrive, remaining work is real account provisioning, operational
data import, private service configuration/deployment and an authenticated
end-to-end acceptance run across all six portals. Those outcomes are not complete
today. The September public demo and its PDF/archive remain synthetic evidence.
