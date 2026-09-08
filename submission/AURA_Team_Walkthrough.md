# AURA: the team walkthrough

**Updated 8 September 2026 | Read this before the demo**

## What are we building?

AURA helps a mentor find students who may need help. It brings their records together, explains the concern, and suggests a support plan. The mentor decides what to do. Later, the mentor checks whether the support helped.

Think of it as one school record book with six doors. Each door is a portal, which means a website for one kind of user. The doors share saved records. Each person can see only the records their role allows.

**How to explain it aloud:** "AURA collects student records, checks for concerns, and suggests support. The mentor checks the suggestion and chooses the plan. The student and parent see the parts shared with them. A follow-up records what happens next. Our demo uses ten fictional students and three mentors."

## Open the project

- [Mentor portal](https://aura-faculty-portal.vercel.app)
- [Student portal](https://aura-student-portal.vercel.app)
- [Parent portal](https://aura-parent-portal.vercel.app)
- [HoD portal](https://aura-hod-portal.vercel.app)
- [AI Activity portal](https://aura-ai-governance.vercel.app)
- [LMS portal](https://aura-lms-portal.vercel.app)

Click a link above. Use **Open portal** or **Open LMS**, choose the demo person, and continue. There is **no password or PIN** for these made-up demo accounts. A long account list uses a dropdown.

Start with **Prof Arjun Bhat** in the Mentor portal. Find **Nikhil Kumar** under **My students**. He is our clear example of a student who may need help.

If an old sign-in tab shows an error, close that tab and start again from the portal link above. Each portal keeps its own sign-in. You may need to choose your person again when you open another portal.

## Read this in order

Pages 2-7 show the people and portals. Page 8 explains the agents. Page 9 gives a tour. Page 10 gives an optional practice run. Page 11 explains what is still left.

**All students, payments, marks and example activities are fictional.** The websites save real changes to this demo. The examples in this guide are a snapshot; they can change when someone edits a record.

<!-- page -->

# 2. What changed, and who is in the demo?

The project now has six portals, including the LMS. Screens use a simple path: **Home, section, details, action**. The HoD home shows department totals and shortcuts. Individual students have their own section.

The password step is gone for the demo. Student course selection can be submitted once per semester. The HoD can reopen it with a reason. Marks, final results, GPA, fees, receipts and mentor follow-ups have their own clear places.

The LMS has lessons, assignments, student work and teacher feedback. Its saved activity feeds the student review. The AI Activity portal shows the actual review steps and their saved results.

## Ten students and three mentors

| Mentor | Assigned students |
| --- | --- |
| Dr Mira Sen | Ananya Rao, Dev Patel, Ishaan Shah, Kavya Nair |
| Prof Arjun Bhat | Meera Iyer, Nikhil Kumar, Priya Das |
| Dr Leena Thomas | Rahul Menon, Sara Ali, Tarun Bose |

Each student has courses, a timetable, attendance, marks, final results, a fee record and a mentor follow-up. LMS examples include no activity, lesson access, submitted work and graded work. Nine parent accounts are linked to the students.

**Nikhil** has low attendance, weak marks and a missed placement activity. His latest review score is **55**, so his mentor should check on him.

**Kavya** has full attendance in the demo classes, strong results and graded LMS work. Her latest review score is **0**. She helps us show that the system does not flag everyone.

## What has been checked?

The cohort checks passed: all ten students have records, mentors see the right students, and running the population script again creates no duplicates. Existing records were kept. Hosted checks covered account choices, student progress, mentor lists, parent fees and LMS feedback.

Three cohort reviews finished. **Six suggestions await mentor decisions; four students were not flagged.** The script did not confirm these plans for the mentors. Two separate ECE student fixtures remain for tests; they are outside this CSE group of ten.

<!-- page -->

# 3. Student portal

**Job: help the student manage courses, see progress and follow their support plan.**

For the support example, enter as **Nikhil Kumar**. For a strong-progress example, enter as **Kavya Nair**.

## Home

Start here for a quick view and links to the next task. The student does not need to visit all six portals. Their own portal and the LMS cover their normal work.

## Course registration

The student chooses courses from the list offered for that semester. The app checks seats, required earlier courses and timetable clashes. A student cannot select two classes that meet at the same time.

The student submits the final choice **once**. The ten demo students already have saved course choices. Seeing a saved choice is expected. A student cannot keep changing it; the HoD must reopen it and give a reason.

## Timetable

This shows the student's registered classes and their times. These are the same course records used by the faculty and LMS.

## My progress

The student can see attendance for each course, assessment marks and published final results.

- **SGPA** is the grade average for one semester.
- **CGPA** is the grade average across published course results.
- A course with more credits counts more in the average.

This demo uses an editable 10-point grade scale. We still need the college's official rules before calling it the college's GPA system.

## My support plan

A suggested plan appears here only after the mentor confirms it. The student can see the shared support steps and follow-ups. The AI's first draft is not an instruction sent straight to the student.

## Open LMS

Use this to reach the learning site. The student sees lessons and assignments for their registered courses. The LMS may ask them to choose their demo account again.

An assignment score, such as **18/20**, belongs to that assignment. It does not automatically replace a final course result or change CGPA.

<!-- page -->

# 4. Parent portal

**Job: help a parent follow their child's progress and see shared updates.**

Choose **Mohan Kumar** to follow Nikhil. Choose **Gopal Nair** to follow Kavya. A parent can see only their linked child or children.

## Home

This gives the parent a starting view and links to the child's records. They do not need access to faculty tools or the agent controls.

## Attendance

The parent sees attendance for each subject. This makes it easier to spot a problem in one class instead of looking only at one overall number.

## Marks & results

The parent sees the marks and final results made available to them, plus SGPA and CGPA. These come from the same saved academic records shown in the Student portal.

## Fees & receipts

The parent sees the fee invoice, how much is paid, how much is left, and any saved receipts. They can try the demo payment flow and download its receipt.

**No real money moves.** The payment and receipt are labelled as a demo. Do not present this as a working bank or payment gateway.

## Mentor updates

The parent sees support information and follow-ups that are allowed to be shared with them. Private mentor notes are not automatically visible to the parent.

## A simple example

Nikhil's mentor checks his records and chooses a short attendance and study plan. After the mentor confirms it, Nikhil can see his shared plan. Mohan can see the parent-visible update. The mentor can then record what happened at the follow-up.

These are pages inside the project. The agents do not automatically send WhatsApp messages, call the parent or contact the college.

<!-- page -->

# 5. Mentor / Faculty portal

**Job: find the students who need attention, decide the support, and check back.**

Enter as **Prof Arjun Bhat**. His mentees are Meera, Nikhil and Priya. A mentee is simply a student assigned to that mentor.

## My timetable and My students

**My timetable** shows teaching classes. Faculty can open assigned classes, record attendance and enter assessment marks or final grades.

**My students** shows assigned mentees. Choose **View student** to see their attendance, marks, results, LMS activity, career signals, fees and mentor history. Teaching a student and mentoring a student are separate assignments.

## Support & follow-ups

**Suggestions:** Open **Review suggestion**. Read **Why this student was flagged** and **Suggested support**. Check the facts before choosing an action.

**Change plan:** Change the support text, allowed action, person responsible or due time. Give a reason. This edits the support plan; it does not edit the student's marks.

**Decision:** Choose **Confirm support plan** or **Dismiss suggestion**, enter a reason, then click **Save decision**. Confirm means the mentor accepts the support plan and shares the allowed parts. Dismiss means the mentor does not use that suggestion.

**Confirmed plans:** Record progress as **Planned / reopen**, **In progress** or **Completed**. Explain what happened and use **Save support outcome**. **Withdraw shared plan** takes back a shared plan with a reason.

**Follow-ups:** Use **Schedule a follow-up** to choose a student, write a note and set when to check back. Record the outcome after the check. Share only the intended parts.

## Start a new review

Open **Start review**, then **Start student review**. Give it a name, choose students, choose the review focus and check the thresholds. The hosted method is **Rules with validation**. Click **Start review**.

The review reads the records and saves suggestions. The mentor still makes the final decision. A high score means **check this student**, not **this student will fail**.

<!-- page -->

# 6. HoD and AI Activity portals

## HoD: manage the department

Enter as **Dr Sahana Krishnan**. HoD means Head of Department.

**Home** shows department totals and tasks. It does not start with a long list of individual students.

**Faculty** holds faculty details and their teaching and mentor assignments. **Students** holds the department's student records. Open a person when you need the details.

**Courses & timetables** covers course details, credits, seats, class times and rooms. The HoD can manage the registration window and reopen a student's selection with a reason.

The HoD can make supported corrections to academic records and the demo grade scale. The app keeps the old value, new value, person making the change and reason. This saved history helps the team see what happened.

**AI activity** gives access to reviews and their controls, including starting work and pausing, resuming or retrying where allowed. The mentor still handles the support decision.

HoD control is limited to their department and the actions the app supports. It does not mean they can rewrite payment history or erase the record of past edits.

## AI Activity: see the work happening

Enter as **AURA Governance Operator** for the observer view. Governance here means watching that the process follows its rules.

- **Overview:** see the current work and totals.
- **Reviews:** open a review and follow its students and steps.
- **History:** see saved events and decisions.

A review shows stages such as **Collect and check records**, **Identify concerns**, **Prepare and check support**, and **Save suggestion for the mentor**.

Open **View recorded evidence** to inspect the saved reasons. A review can wait, run, stop for missing records, await the mentor, or finish with no concern found.

The observer can inspect the saved work. The HoD has the relevant controls.

<!-- page -->

# 7. LMS: course, lesson, assignment, feedback

**LMS means Learning Management System. It is the place for class work.**

Open the LMS link and choose a student, faculty member or HoD. Students see their registered courses. Faculty see their teaching courses. The HoD sees department courses.

## Student walkthrough

1. Open **Courses**, choose a course, and use **Open course**.
2. Open **Lessons**, then **Open lesson**. Read the lesson. The app saves that the student opened it.
3. Open **Assignments**. Read the task and due date. Submit the answer as text or an allowed file.
4. Open **Feedback** after the teacher grades the work. Read the score and the teacher's comment.

Files are private to the allowed users and may be up to **2 MB**. Opening a lesson is evidence of access. It is not proof that the student understood it.

## Faculty walkthrough

1. Open an assigned teaching course.
2. Add and publish the lesson.
3. Add and publish an assignment with a due date and maximum score.
4. Open the student's submitted work.
5. Enter the score and useful feedback, then publish it.

The student can now see that feedback. A graded submission cannot simply be overwritten. For another practice run, create a new assignment with a clear demo name.

## What is already there?

The four courses are Machine Learning Foundations, Agentic AI Systems, Responsible AI Engineering and Distributed Systems. Each has a published demo lesson and assignment.

Kavya, Priya and Sara have graded work. Dev and Rahul have submitted work awaiting feedback. Meera and Tarun have opened a lesson. Ishaan and Nikhil have no LMS activity yet. Ananya's earlier graded work is also kept.

The student review uses these saved LMS records. It can check access and overdue work alongside attendance and marks. A new student with no activity is not automatically treated as someone who has been inactive for seven days.

<!-- page -->

# 8. How the agents work

An agent is a software worker with a job. Here the workers share records and pass work to the next step. They do not all need a separate language model.

1. **Plan the review.** The coordinator saves the students, focus and rules chosen for the review.
2. **Collect the facts.** Four collectors check academic records, LMS activity, internship milestones and placement activities. These collectors can work at the same time. Career examples are still made-up inputs.
3. **Check the facts.** The system checks the student, semester, missing records and how old the evidence is. Bad or missing evidence can stop the review. It does not invent a good result.
4. **Find concerns.** The risk worker applies the saved point rules below.
5. **Prepare support.** A helper finds allowed guidance and past plans for that student. The selected specialist prepares support for the review focus: academic progress, attendance or an optional support referral.
6. **Check the suggestion.** A validator checks the facts, evidence and allowed actions. A failed draft may get a limited repair attempt. It is not allowed to retry forever.
7. **Save and hand over.** The system saves its work and history. It can resume from saved steps. The mentor checks the suggestion, makes the decision and tracks the outcome.

## The current demo point rules

| Evidence | Points added |
| --- | --- |
| Attendance below 75% | 20 |
| Assessment average below 60 | 20 |
| LMS inactivity of at least 7 days | 20 |
| At least one overdue assignment | 10 |
| At least one missed internship milestone | 15 |
| At least one missed placement activity | 15 |

Below 20 is low, 20-49 is medium, and 50 or more is high. **Nikhil: 20 + 20 + 15 = 55.** His score is not a 55% chance of failure.

The live websites use **Rules with validation**. The code also supports an optional language model, tested separately in a local setup. A language model is not currently driving the hosted suggestions. Do not tell the professor that it is.

<!-- page -->

# 9. A simple tour for the team

This first tour reads what is already saved. Everyone can follow the same person through the sites without changing the demo.

## 1. Start with the mentor

Open the Mentor portal as **Prof Arjun Bhat**. Go to **My students** and open **Nikhil Kumar**. Read his attendance and marks. In the prepared data, his attendance is 50% and his assessment average is 46/100.

Open **Support & follow-ups**, then **Suggestions**. Find Nikhil's latest suggestion and use **Review suggestion**. Read why the review flagged him. Leave the decision unchanged during this first tour.

## 2. See what the agents did

Open AI Activity as **AURA Governance Operator**. Under **Reviews**, find the latest cohort review for Arjun's students. Open Nikhil's result and recorded evidence. Follow the collection, checks, score and saved suggestion.

His 55 points come from attendance, assessment marks and a missed placement activity. The system has not claimed that he has seven days of LMS inactivity.

## 3. Look through the student's door

Open the Student portal as **Nikhil Kumar**. Check the saved course choice, timetable and **My progress**. Open **My support plan**. A new suggestion will not appear as a shared plan until the mentor confirms it.

## 4. Look through the parent's door

Open the Parent portal as **Mohan Kumar**. Check Nikhil's attendance, marks and fees. Visit **Mentor updates**. Compare what is shared with what the mentor can see.

## 5. Show a strong-progress example

Open the LMS as **Kavya Nair**. Open a course and **Feedback**. Show the saved score and comment. Her example includes an 18/20 assignment score. Her current student review has no warning.

## 6. End with the department view

Open the HoD portal as **Dr Sahana Krishnan**. Show the department overview first. Then open **Faculty**, **Students**, and **Courses & timetables**. Explain why these details have their own sections.

The main story is: **records lead to a reason, the reason leads to a support suggestion, and the mentor chooses what happens next.**

<!-- page -->

# 10. Practice the full loop

This part changes the shared demo. Have one teammate drive while the others watch. Use a new name, such as **Team practice - Nikhil - 8 Sep**, so the team can find its own work later.

## Add learning activity

1. Enter the LMS as **Prof Arjun Bhat**. Open **Responsible AI Engineering (CS402)**, his teaching course.
2. Publish a short new practice assignment. Give it a future due date and a clear maximum score. Do not replace the existing graded work.
3. Enter the LMS as **Nikhil Kumar**. Open the same course. Read a lesson and submit an answer to the new assignment.
4. Return as Arjun. Open that submission, give a score and write one useful comment. Publish the feedback.
5. Return as Nikhil and open **Feedback**. Check that the score and comment appear.

## Run the student review

6. In the Mentor portal as Arjun, open **Support & follow-ups**, **Start review**, then **Start student review**.
7. Give the review a new practice name. Select Nikhil, choose **Academic progress**, and use **Rules with validation**. Review the thresholds, then start it.
8. Open AI Activity to follow the saved steps. New lesson access and submission records should be available to the review. Do not expect this one assignment to repair low attendance, change final course results or erase every concern.

## Make and follow the support decision

9. Return to the mentor's **Suggestions**. Open the new suggestion, read the evidence and check the support. Use **Change plan** if needed. Choose **Confirm support plan**, give a reason and use **Save decision**.
10. Open the Student portal as Nikhil and check **My support plan**. Open the Parent portal as Mohan and check the allowed shared update.
11. As Arjun, schedule a follow-up. Add a clearly labelled practice note. After a pretend follow-up, record a **demo outcome**. Do not claim a real meeting happened or that a real student improved.

The database is the shared storage behind the portals. Reloading a page should keep a saved change. If another teammate has changed the same record, refresh and check the latest version before editing it again.

<!-- page -->

# 11. What is ready, and what is still left?

## Ready in the project

The source code, six connected portals, LMS, demo cohort, agent workflow, mentor decisions, follow-ups and saved history are included. The ZIP also has the project report, lab notebook, setup guide, demo script and recorded checks.

After extracting **AURA_Chapter11_Submission.zip**, open **submission/README.md**. Start with this walkthrough. Use **DEMO_SCRIPT.md** for the longer demo, **VIVA_GUIDE.md** for questions and **PROJECT_REPORT.md** for the design. **LOCAL_SETUP.md** explains how to run a separate local copy. The application code is in **platform/**.

## Still needed before final submission

- **Professor's agreement on the case.** Chapter 11 section 11.2 and Lab 14 ask for a real case. Our people and events are fictional. Ask whether the professor accepts this demo instead. If not, the team needs permission for a real case and an actual mentor review.
- **An honest model explanation.** The hosted demo uses rules with validation. Use the documented local model setup if a language-model demonstration is required. Label that run separately.
- **Team rehearsal and final hand-in.** Agree who shows each part, practise the full loop, check the professor's required format and deadline, and submit through the required channel. Sending this ZIP to WhatsApp is a team handoff, not the final college submission.

Real college systems, official GPA rules and real payments are not connected. We must not claim real student results or college approval.

## Questions the team should be able to answer

**Why agents instead of one chatbot?** Different workers collect, check, score and prepare support. The app saves each step and hands the decision to the mentor.

**Can the AI change marks or punish students?** No. It prepares support suggestions. Allowed faculty and HoD actions handle academic edits.

**What if records are missing?** The review can stop and show the problem instead of making up facts.

**Has the project helped real students?** We have tested software and fictional examples. We have not proved an effect on real students.

*Based on the current project code, portal specification, demo cohort records and release evidence. Snapshot: 8 September 2026.*
