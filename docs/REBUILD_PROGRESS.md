# Six-portal rebuild progress

8 September 2026. Implementation and local acceptance complete; production release is the next step.

## Implemented

The agreed scope in PORTAL_EXPERIENCE_SPEC.md is implemented across Student, Parent, Mentor, HoD, AI Activity and the new LMS. Home screens lead to named sections and details. HoD Home contains department totals and shortcuts, without individual students. Demo entry remains PINless.

- Atomic, final semester course selection; existing registration endpoints respect the lock; HoD can reopen with a reason.
- Separate teaching and mentor assignments. Scoped student profiles, shared follow-ups and outcomes.
- Attendance, published assessment/final results, credit-weighted GPA, editable demo grade scale, simulated fee payments and downloadable demo receipts.
- Department course, timetable, registration, people and mentor controls with prior values, actor, reason and revision checks.
- LMS lessons, assignments, private files up to 2 MB, immutable submission versions and published feedback. Chapter 11 reads actual LMS activity; opening a lesson proves access, not learning.
- HoD AI review settings and start/pause/resume/retry; actual stages, failure reasons and method; assigned mentor confirmation before publication.
- Six OAuth clients reuse five identity roles. Parent field grants and department/mentor/course scope are enforced in Core.

## Local evidence

All eight service production builds, ten package lint tasks and all type checks passed. Seven platform tests and eighteen Core unit tests passed; the four intentionally skipped database suites were run separately and passed (base regression, Chapter 11 lifecycle, LMS, portal experience). Production dependency audit reported zero vulnerabilities.

The LMS browser walkthrough published a lesson and assignment, submitted Ananya's work, published faculty feedback and showed 18/20 after a fresh student login. The Chapter 11 browser walkthrough started from current records, awaited the mentor, and published confirmed support to the student. Six-portal quality checks passed at 390, 768 and 1440 px with no serious/critical Axe findings or tested runtime errors. A repeated attendance test exposed locator timing/ambiguity against retained test records; the final rerun passed in 23.5 seconds after selecting the exact dated sheet and supplying the required correction reason.

The credential-free Chapter 11 build passed with eight students and identical sequential/parallel output quality. Its controlled-I/O timing is not a production latency claim. The report was regenerated as a three-page Word/PDF document and rendered for inspection.

## Release work

Apply additive migrations 005 and 006 to production, provision the sixth OAuth client, deploy the committed candidate to all eight services, verify fresh hosted sessions and LMS workflow, then refresh the submission ZIP. Use RELEASE_EVIDENCE.md for completed hosted verification. Never reset production as test preparation.

## Boundaries

All records are synthetic. Internship/placement sources remain synthetic normalized fixtures; academic and LMS evidence comes from the connected demonstration records. Hosted recommendations use rules with validation. The model adapter and previously verified local model evidence are retained; this rebuild does not establish hosted LLM execution. Official grade rules and real payment integration were not supplied, so the labelled editable 10-point demonstration scale and simulated receipts remain.

The professor's actual real-case/mentor-approval requirement remains external. Do not claim synthetic identities are institutional sign-off. The recurring release automation remains paused.
