# Ten-student demonstration cohort

This is fictional project data. Populating it does not claim that real students took classes, submitted work, paid fees or met a mentor. The existing two ECE students and their faculty remain as separate department fixtures for access-control checks.

| Mentor | Students |
| --- | --- |
| Dr Mira Sen | Ananya Rao, Dev Patel, Ishaan Shah, Kavya Nair |
| Prof Arjun Bhat | Meera Iyer, Nikhil Kumar, Priya Das |
| Dr Leena Thomas | Rahul Menon, Sara Ali, Tarun Bose |

The cohort includes strong attendance and grades, low attendance, weak assessment scores, unstarted LMS work, submissions awaiting feedback, published feedback, upcoming mentor follow-ups and one fictional completed follow-up. Nikhil combines attendance, marks and a missed placement activity. Kavya and Priya provide examples with no current warning. These are designed scenarios, not predictions of educational outcomes.

Each student has registered courses, timetable entries, at least eight attendance records, published assessment marks, results for GPA, a fee invoice and a mentor follow-up. Ananya's existing locked course selection, result, paid demo invoice, LMS feedback and support history are preserved. New students without a final selection take CS301, CS402 and CS403, which have no timetable conflict. Ananya retains CS401 and her completed CS301 record.

Four courses have a published demo lesson and an assignment. New assignments are due seven days after initial population. Some students have opened lessons, some have submitted, some have received feedback, and two have no LMS activity. Activity is recorded when the seed executes; it is not backdated to manufacture inactivity. Historical attendance sheets explicitly say “Demo class”. Marks, answers, feedback, invoices and follow-ups identify their demonstration purpose. Career evidence remains labelled synthetic fixtures.

Three separate cohort reviews use the existing four-source collection and rules-with-validation workflow. They create support suggestions for flagged students and leave those suggestions awaiting mentor decisions. The script does not approve or publish those suggested support plans. These scripted demo policies are not actual faculty or institutional approval.

## Run and repeat

From `platform`, after `npm run initialize:local`:

```sh
npm run populate:local
```

The underlying entry point is `services/core-api/scripts/populate-demo-cohort.ts`. Without `--apply` it only reports the current cohort. For an authorized hosted demo operation, explicitly load the private Core service environment instead of the root local/test environment. Never commit environment files.

The additive population accepts only the AURA-DEMO institution with the original `@aura.invalid` identities and `SYN-CSE-` student profiles. It does not call reset, delete history, change an existing course result or replace a final registration. Deterministic command IDs make completed steps repeat-safe; a session lock prevents two population runs colliding. Later mentor edits are preserved. A conflicting manually changed initial mentor assignment stops population for inspection. A changed institutional generation also stops the run. If a run is interrupted, inspect the last error and rerun against the same generation.

Domain commands enforce enrollment, faculty teaching scope, mentorship, revision checks and the audit trail. New fee invoices use an audited additive transaction because no user-facing invoice-creation command exists. Dates are anchored to the first run. Opening a lesson records access, not proof of learning. The demo's term and registration window must be open for a fresh cohort to enroll.

All ten students, three mentors and nine existing linked parents have demo account choices. The LMS reuses student, faculty and HoD identities. Longer account lists use one selector and one Open portal button. No PIN is requested.

## Verification

`RUN_COHORT_DB_TESTS=1` enables `services/core-api/tests/demo-cohort.test.ts`; its schema must begin `aura_core_test_cohort`. It tests 4–3–3 scope, academic/LMS availability, teaching permissions, low/medium/high review outcomes, preservation of an edited follow-up and the existing historical result, and zero duplicate events or people after a second population.
