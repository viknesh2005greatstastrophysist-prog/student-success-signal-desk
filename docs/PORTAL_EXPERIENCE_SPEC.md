# AURA portal experience agreement

Updated 8 September 2026 from Vik's portal-by-portal clarification. Implementation authorized after the LMS discussion. This document replaces earlier interface direction where it conflicts; it is a specification, not a claim that the new features are deployed.

## Shared rules

- KISS: overview -> choose an area -> inspect details -> act.
- Six connected portals: Student, Parent, Mentor/Faculty, HoD, AI Activity, LMS.
- Plain English. Buttons name their effect. Avoid artifact, lineage, Core boundary, and technical slogans in normal workflows.
- Same underlying people, course offerings, enrolments and records throughout. No repeated course registration in the LMS.
- Department scope for HoD; assigned students for mentors; linked child for parents; own work for students. An LMS portal is a website, not a new institutional role.
- Normal home pages show summaries and next tasks. Individual records belong in their relevant sections. HoD home must not list individual students.
- Technical details, approval history and evidence remain inspectable, behind clearly named details controls.
- Demonstration identities and records remain explicitly synthetic. A rule-based run must not be labelled as a language-model run.

## Student

Home; Course registration; Timetable; My progress; My support plan. Registration selects from available semester courses, reviews the selection and submits once. Proposed interpretation accepted in the conversation: one final semester submission; HoD can reopen it for correction. LMS links open the corresponding registered course.

Progress includes attendance and marks by course and published SGPA/CGPA. Support displays the mentor's confirmed plan and follow-up tasks.

## Parent

Home; Attendance; Marks & results; Fees & receipts; Mentor updates. Attendance includes each subject's attended/missed/total counts and percentage. Results include published SGPA/CGPA. Fees show paid/outstanding amounts, due dates, payment and downloadable receipts. Mentor updates contain intentionally shared support information and contact details. Do not introduce another chat system.

## Mentor / faculty

Home; My timetable; My students; Support & follow-ups. Distinguish teaching assignments from mentees. Student profiles expose appropriate attendance, results, LMS activity, internship/placement signals, fee status and mentoring history. Faculty may enter attendance and marks for their assigned courses.

Support flow: review a flagged student -> read triggering records -> inspect suggested steps -> Confirm support plan / Change plan / Dismiss suggestion -> record follow-up and outcome. The human decides; the agents prepare suggestions. Cases can be reopened. Mentor approval remains required before sharing the plan.

## HoD

Home; Faculty; Students; Courses & timetables; AI activity. Home has department totals, pending tasks, review status and section shortcuts; no individual student list.

Within the department: manage faculty/course/mentor assignments, courses, timetable and registration settings; reopen registration; correct academic records and support plans. Corrections retain earlier values, actor and reason. These are domain controls, not permission to overwrite audit history or edit another department.

## AI activity

Overview; Reviews; History. Detail sequence: collect four sources -> check records -> identify concerns -> prepare and check support -> wait for mentor -> record decision. Show responsible workers, status, timestamps, concise failure reasons and actual suggestion method. HoD controls include starting/pausing/resuming reviews, retrying failed work and review settings. Technical evidence stays in details.

## LMS

User authorized implementation of course -> lesson -> assignment -> feedback.

- Home: next coursework and recent feedback; Course list from existing registrations or teaching assignments.
- Course detail: lessons/materials, assignments, submissions and feedback. Keep a return-to-course link and clear next action.
- Faculty: create/publish lessons and assignments, set due dates and maximum marks, review submissions, publish scores and written feedback.
- Student: read published lessons, submit their own work, receive a dated submission confirmation, and view published feedback. Draft edits must not silently replace a submitted version.
- HoD: manage department LMS content and inspect progress; faculty still perform ordinary grading.
- Files/material references must be scoped and durable; every displayed upload or download control must work. No paid storage dependency without authorization.
- Record actual lesson access and submission events; derive LMS inactivity and overdue work from those events. Opening a lesson is evidence of access, not proof of learning.
- A never-active student and a student with no assigned work are different states. Derive overdue work from published due assignments and submissions, excluding withdrawn/unregistered courses.
- Feed normalized, cited LMS evidence into the existing Chapter 11 source collector. Never silently substitute fixed fixtures for LMS activity. Existing archived review evidence remains unchanged.
- Assignment feedback is distinct from final semester results; GPA uses published course results and credits, not every LMS score directly.

## Pending optional answers

- Official grade bands/credit rules requested. Default if not supplied: editable, clearly labelled 10-point demonstration scale.
- Payment mode requested. Default: simulated payments and demo-labelled receipts, consistent with the existing project.

## Build and acceptance checklist

- [x] Add LMS persistence, commands, scoped reads and activity-derived evidence.
- [x] Add sixth portal with existing identity roles and working student/faculty/HoD access.
- [x] Implement lesson -> submission -> feedback end to end.
- [x] Implement semester registration confirmation and HoD reopening.
- [x] Separate mentor assignments; add complete student profiles, follow-up workflow and results.
- [x] Add HoD department management and AI review controls.
- [x] Replace everyday screens/copy across all six portals with the agreed navigation.
- [x] Verify permissions, persistence, stale updates, duplicate submissions, results and cross-portal consequences.
- [x] Verify an actual browser walkthrough at desktop/mobile sizes.
- [ ] Deploy tested services, verify fresh production sessions and update submission package/evidence.

## Starting evidence

At implementation start HEAD is a11149d. The current platform has five portal types. Chapter 11 LMS input is read from seeded `ch11_sources`; no student lesson/submission workflow exists. Existing production deployment evidence predates this redesign. The source brief still requires authorized real-case evidence or professor acceptance of a synthetic demonstration; software changes cannot invent that acceptance.
