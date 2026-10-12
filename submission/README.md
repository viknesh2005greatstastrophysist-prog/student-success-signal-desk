> Current project edition: see [Final project report](../docs/FINAL_PROJECT_REPORT.md) and [Runbook](../docs/PROJECT_RUNBOOK.md). The private edition uses supplied sources plus generated operations; the earlier institutional requirements below apply to verified college rollout.

# Chapter 11 submission guide

AURA Student Success and Early Warning combines four evidence sources, applies a mentor-approved risk policy, produces a validated support draft, and publishes it only after the assigned mentor approves. The student, parent, faculty, department, AI activity and LMS portals share PostgreSQL state.

## Live demonstration

- Faculty: https://aura-faculty-portal.vercel.app
- Governance: https://aura-ai-governance.vercel.app
- Student: https://aura-student-portal.vercel.app
- Parent: https://aura-parent-portal.vercel.app
- Department: https://aura-hod-portal.vercel.app
- LMS: https://aura-lms-portal.vercel.app

Demo entry requires no PIN or password as of 8 September 2026. Anyone with the portal links can enter the synthetic demo roles. The hosted workflow uses the labelled deterministic mode. For the actual language-model demonstration, use the configured local installation and follow `DEMO_SCRIPT.md`. The local model execution is recorded separately from cloud execution.

This Chapter 11 guide and `../docs/RELEASE_EVIDENCE.md` are the current handoff. Older prototype reports elsewhere in the source archive are historical evidence, not the current release status.

## College attendance source data

The 12 October implementation now includes a private agent workflow with 321
persistent clarification packets and authenticated college-record endpoints/pages
in all six portals. See [real-college rollout](../docs/REAL_COLLEGE_ROLLOUT.md)
and [required college inputs](../docs/WHAT_I_NEED_FROM_YOU.md). The prepared packets
preserve unknowns and cannot publish student support. Real accounts, operational
records, hosted deployment and actual mentor acceptance remain outstanding.
The September PDFs and archive describe the synthetic demonstration; they have
not been regenerated as proof of a real-college rollout.

The project includes a private local import and a searchable source-review screen for attendance and final CIE exports. See `../docs/COLLEGE_ATTENDANCE_IMPORT.md`. Earlier college permission was reported by the project owner; the 12 October instruction authorizes local use of the Downloads reports. Six unique workbooks cover 321 students, including CIE records for 67 of them. Original student data and derived records stay in the ignored `runtime/college-attendance/` directory and are excluded from source/submission archives. These imports do not replace the public demo cohort. Reporting dates, numeric units, maximum CIE marks and source status meanings remain unknown; mentor mappings, LMS activity and other required real-case evidence are still absent.

## Start here

1. Read [AURA_Team_Walkthrough.pdf](AURA_Team_Walkthrough.pdf) for the simple-English team guide: latest changes, ten students and three mentors, all six portals, agents, a guided tour, practice steps and remaining submission needs. Its editable source is [AURA_Team_Walkthrough.md](AURA_Team_Walkthrough.md).
2. Read `PROJECT_REPORT.md` for the design and the distinction between implemented software and institutional approval.
3. Run `Chapter11_Lab_Demonstration.ipynb` or `cd platform && npm run chapter11:build` for a reproducible, credential-free lab artifact.
4. Use `DEMO_SCRIPT.md` to demonstrate the connected portals.
5. Review `../docs/CHAPTER11_COMPLETION.md` and `../platform/artifacts/chapter11/` for acceptance evidence.
6. Use `LOCAL_SETUP.md` for a separate local installation and `VIVA_GUIDE.md` to prepare your explanation.
7. See `../docs/DEPLOYMENT.md` for the eight-service deployment procedure and private environment setup.

## Important submission boundary

The professor's Chapter 11 sections 11.2 and Lab 14 explicitly require a real case.
The public submission demonstration uses synthetic cases. Private actual-data
clarification packets now exist, but they do not establish a real mentor's
approval of the methodology or institutional account access. The owner requires
real users across all six portals. Complete that private rollout and obtain
actual academic acceptance before describing the capstone as fully signed off.

No credentials, access PIN, session traces or real student records belong in this submission folder. The full source repository is part of the project; the notebook calls its TypeScript implementation rather than maintaining a separate imitation.

## Six-portal rebuild

The current interface follows overview → section → details → action. Registration is submitted once per semester, with audited HoD reopening. Teaching assignments and mentor assignments are separate. Course results produce credit-weighted SGPA/CGPA using an editable demonstration scale; LMS assignment scores remain separate. Parent payments remain simulated and receipts say so. The LMS records actual lesson access, submissions and feedback. Those records supply its Chapter 11 evidence. See `../docs/PORTAL_EXPERIENCE_SPEC.md` for the agreed scope and `../docs/REBUILD_PROGRESS.md` for current verification.
