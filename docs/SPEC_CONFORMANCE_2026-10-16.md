# Spec conformance checklist: AURA against Chapter 11 (16 Oct 2026)

**Scope.** The spec is Chapter 11 of the 14-Lab Worklet Build Book (`runtime/streamlit-project/lab-manual.txt`, lines 6375 to 7002), all sections 11.1 to 11.12, read in full. From the other 14 chapters only the requirements stated as common to every worklet were taken: the book's design principle, the shared 14-lab method text (repeated verbatim in all 15 chapters), the shared KPI and risk rows, and themes that recur in most chapters' guardrails (approval with approver recorded, audit log, confidentiality, version history and rollback, flag-for-review-only, show method and source). Out of scope: other chapters' domain content, the Week-3 "share with all faculty" process checkpoint, team-ownership and staffing, the paused Vercel portals, and the F1 to F13 fixes already closed in `docs/E2E_TEST_LOG.md`. The app under test is the Streamlit front end (`streamlit_app/`) and the Core it calls through `platform/scripts/streamlit-worker.mts`; the bundle `streamlit_app/engine.mjs` was last rebuilt in `39e2a12` and `git log` shows no Core change since. Method: code reading only; nothing was run. Path shorthand: `core/` = `platform/services/core-api/lib/`, `ch11/` = `core/chapter11/`, `app/` = `streamlit_app/`.

Status counts. Chapter 11 table: 44 verified-in-code, 1 needs-runtime-check, 9 gap, 2 deferred-by-owner (56 rows). Cross-cutting table: 13 verified-in-code, 1 gap (14 rows). P1 gaps: none found.

## 1. Chapter 11 requirements

| ID | Requirement (section) | Where in the app | Status | Note |
|---|---|---|---|---|
| C11-01 | Four sources linked, scoped and authorized for student support; intake only after all four are linked (11.2, 11.8 Gate 1) | `ch11/service.ts:524`, `:566`, `:667`; `ch11/engine.ts:319` | verified-in-code | Checked per student at collection: a missing link blocks that student (`DATA_BLOCKED`) before scoring rather than refusing the whole run. Internship and placement are generated project records (`docs/CHAPTER11_COMPLETION.md:26`). |
| C11-02 | Four collection agents normalise per-student fields in parallel (11.2, 11.4 #1 to #4, 11.8) | `ch11/service.ts:1466` (`collectSnapshot`, concurrency 4), `ch11/graph.ts:2` | verified-in-code | One shared repeatable-read snapshot. |
| C11-03 | Contineo agent: attendance, CIE marks, academic performance; current semester only; flag missing entries (11.4 #1) | `ch11/service.ts:575-660`, `ch11/engine.ts:319` | verified-in-code | Missing academic evidence blocks the student. Semester is a fixed "2026-ODD" label (`:650`), see P3-3. |
| C11-04 | LMS agent: logins, submissions and quiz scores; scores and timestamps, not raw content; flag no-activity students (11.4 #2) | `core/lms-queries.ts:186`; `ch11/engine.ts:371` (`LMS_INACTIVE`) | gap | Evidence carries `inactivityDays` and `overdueAssignments` only; no quiz scores. No raw content is sent (correct). |
| C11-05 | Internship agent: registration, status, evaluation; cite source and date; flag missing expected record (11.4 #3) | `core/data-refresh/generator.ts:372`; `ch11/engine.ts:265` | gap | Record has `missedMilestones` and `status`, plus `recordId`/`observedAt`; no registration or evaluation fields. Missing record blocks the student. |
| C11-06 | Placement agent: readiness, application activity, interview outcomes; flag stale activity (11.4 #4) | same as C11-05; freshness check `ch11/engine.ts:319` | gap | Only `missedActivities` and `status`. Stale evidence is blocked by `freshnessDays`. |
| C11-07 | Risk agent combines the four signals into a composite score and flags against approved thresholds (11.2, 11.4 #5) | `ch11/engine.ts:371`, policy schema `:37` | verified-in-code | Six weighted signals across four sources, capped at 100; flag at `mediumScore`. |
| C11-08 | Show which signals drove each flag; never label without a review path (11.4 #5) | Mentor > Mentees > Risk view, `app/views/reviews.py:907`, `:986` | verified-in-code | `reviewRequired: true` on every risk; review-path text shown per flagged student. |
| C11-09 | Risk scoring only after all four sources return (11.8) | `ch11/graph.ts:16-24`; `ch11/service.ts:1466` | verified-in-code | Snapshot completes before EvidenceValidator and RiskAnalysisAgent. |
| C11-10 | Plans drafted only for flagged students, from flagged signals and approved intervention types (11.4 #6, 11.8) | `ch11/service.ts:1351`, `:1070`; `ch11/packet-v2.ts:438` | verified-in-code | Unflagged students end `not_flagged` with an audit row. |
| C11-11 | Never contact a student; route through the mentor (11.4 #6, 11.12) | no messaging code in `core/` or `app/`; `ch11/engine.ts:763` (`advisor_review_required`) | verified-in-code | Every action must be owned by the assigned faculty; contact wording is rejected. |
| C11-12 | Mentor approves or adjusts the plan and the intervention is logged (11.2, 11.4 #7) | Mentor > Reviews, `app/views/reviews.py:1840-1898`; `core/support-commands.ts:246`, `:318` | verified-in-code | Decision bound to artifact id, content hash and revision; only the assigned mentor (`:283`, `:294`). |
| C11-13 | Gate returns approve, edit or override; each action approved or adjusted (11.5, 11.8) | `app/views/reviews.py:1901-1990`; `ch11/packet-v2.ts:438` | gap | Summary and due days can be edited. The Action and Owner columns are editable but any change fails revalidation (`CATALOGUE_OR_DOMAIN_MISMATCH`, `ADVISOR_REVIEW_REQUIRED`). No override. See P2-2. |
| C11-14 | HoD/Dean reviews aggregate risk trends and intervention outcomes each cycle (11.2, 11.11 step 5) | HoD > Overview, `app/views/hod.py:163`; `ch11/service.ts:1691-1716`, `:1654` | verified-in-code | Per-cycle reviewed, flagged, approved, completed, withdrawn and band averages; averages hidden below 3 students. |
| C11-15 | Coordinator receives the faculty/HoD prompt, checks permissions, builds and locks the plan (11.4 #0, 11.7) | `ch11/planning.ts`, `ch11/service.ts:467`, `:1214`; `app/views/reviews.py:453` | gap | Mentor only. The HoD cannot start a review (made read-only in E2E #12, `docs/E2E_TEST_LOG.md:154`), which the spec allows. See P2-7. |
| C11-16 | Coordinator enforces data scope, audit logging, source citation and exception routing (11.4 #0) | `ch11/service.ts:667`, `:1426-1460`, `:1502-1556` | verified-in-code | Blocked, needs-human and AI-unavailable states, each audited. |
| C11-17 | Check: each alert cites its triggering signals (11.7) | `ch11/engine.ts:763` (`alerts_cite_triggers`) | verified-in-code | Shown under "How this was made", `app/views/reviews.py:1562`. |
| C11-18 | Check: thresholds are faculty-set (11.7) | `ch11/engine.ts:763`; `core/support-commands.ts:305`; `ch11/service.ts:209` | verified-in-code | Policy attestation by the owning faculty is required again at approval. |
| C11-19 | Check: no student labelled without advisor review (11.7) | `ch11/engine.ts:763` (`advisor_review_required`) | verified-in-code | |
| C11-20 | Check: privacy scope enforced (11.7) | `ch11/engine.ts:763`; egress guard `ch11/egress.ts:375` | verified-in-code | Output PII and cross-student evidence fail the check. |
| C11-21 | On failure, diagnose and regenerate only the failing part, bounded (11.7, Lab 10) | `ch11/engine.ts:975`; `ch11/graph.ts:15` (`maxRepairs: 2`), `:196` | verified-in-code | |
| C11-22 | On exhaustion, escalate to the mentor with the diagnosis (Lab 10, 11.11 runaway loops) | Core `ch11/service.ts:1426-1460`; UI only at `app/views/reviews.py:848` | gap | Escalated and AI-unavailable students appear only inside the plan's run on Reviews > Start a review and as a Risk view status; not on Today or in the gate count. See P2-3. |
| C11-23 | KPI: 100% of checks pass before mentor review; nothing reaches the mentor without a green report (11.2, Lab 11) | `ch11/service.ts:1079`; `core/support-commands.ts:301-305` | verified-in-code | |
| C11-24 | KPI: every plan grounded in verified records and faculty thresholds, with an evidence record (11.2, Lab 9) | `ch11/service.ts:1086-1120` (evidence snapshot, input hash); `ch11/packet-v2.ts:441-447` | verified-in-code | |
| C11-25 | A published plan rests on current verified records (11.2 KPI 2, 11.12 guardrail 1) | `ch11/awaiting.ts` (no currency filter); `core/support-commands.ts:300`; `core/data-refresh/generation.ts:123` | gap | A draft computed before the latest data refresh stays approvable; the family guard then hides the plan while the confirmation says the student and parent will see it. See P2-1. |
| C11-26 | KPI: zero consequential actions without mentor approval (11.2) | sole `INSERT INTO support_plans` is `core/support-commands.ts:318` | verified-in-code | |
| C11-27 | KPI: complete audit trail of flags, recommendations and interventions (11.2, 11.12) | `writeCommandLedger` in decide, edit, outcome, restore; `audit()` events in `ch11/service.ts` | verified-in-code | |
| C11-28 | KPI: one-click rollback (11.2, Lab 12) | `ch11/review.ts:178`, `:240`, `:378`; `app/views/reviews.py:1151`, `:1173` | verified-in-code | Restore is one click; withdraw is a form (status, 12-character reason, Save). See P3-1. |
| C11-29 | Governed publish on approval, versioned (11.5, 11.7, Lab 12) | `agent_artifacts.artifact_version`, `ch11_publications`; `ch11/review.ts:378` | verified-in-code | |
| C11-30 | After approval, dashboard, risk scores and intervention log update together (11.8) | one transaction in `core/support-commands.ts:246-344` | verified-in-code | Family pages may lag up to 60 s (session read cache, `app/common.py:118`). |
| C11-31 | Dashboard: composite risk view, per-student score with contributing signals (11.9) | Mentor > Mentees > Risk view | verified-in-code | |
| C11-32 | Dashboard: at-risk flags with visible reasoning and review path (11.9) | Risk view "Why each student was flagged", `app/views/reviews.py:986` | verified-in-code | |
| C11-33 | Dashboard: drafted plans awaiting approval (11.9) | Mentor > Today, Reviews > Drafts at the gate | verified-in-code | |
| C11-34 | Dashboard: intervention log with approved actions and outcomes, with aggregate risk trends (11.9) | Mentor > Mentees > Outcomes, `app/views/reviews.py:1017` | gap | Log and outcome counts present; the mentor workspace has no risk-trend chart (only the HoD has one). See P2-4. |
| C11-35 | Exportable intervention log (11.11 pilot artifacts) | `app/views/reviews.py:1109` (CSV) | verified-in-code | |
| C11-36 | Lab 1: clarify, plan, revise; a vague request gets at least two clarifying questions and an editable plan | Reviews > Start a review; `ch11/planner.ts:211`; `ch11/planning.ts:214-293` | needs-runtime-check | Question count depends on the live model plus server-added questions. Click-through in section 5. |
| C11-37 | Lab 2: key numbers come from tools, not the prompt | `ch11/engine.ts:371`; `ch11/investigator.ts` | verified-in-code | |
| C11-38 | Lab 3: reusable, typed plan and format skills | `ch11/engine.ts:224`, `:551`, `:612` | verified-in-code | |
| C11-39 | Lab 4: run state separate from stored history; retrieval by tags and similarity, top 5 | `ch11/engine.ts:484`; `ch11/service.ts:751` | verified-in-code | Lexical embedding, stated as not semantic (`docs/CHAPTER11_COMPLETION.md:26`). |
| C11-40 | Lab 5: one connector for attendance and assessment, LMS and prior interventions; no direct source access | `ch11/service.ts:697`, `:720` (`sourceAdapterRegistry`) | verified-in-code | |
| C11-41 | Lab 6: runtime with budgets, gates, checkpoint and resume, audit of inputs and outputs | `ch11/service.ts:993`, `ch11/lease.ts` | verified-in-code | |
| C11-42 | Lab 7: explicit node graph with a bounded back-edge; one command gives a validated draft | `ch11/graph.ts`; Run review button (`plan_execute`) | verified-in-code | |
| C11-43 | Lab 8: parallel fan-out and merge by plan alignment | `ch11/engine.ts:1297`; `ch11/service.ts:1562` | verified-in-code | |
| C11-44 | Best-of-N candidates screened, best selected, rest logged (11.7 worked example, Lab 8) | `ch11/engine.ts` (`selection.candidates` holds one) | deferred-by-owner | Brief 14 deferred, `docs/AUDIT_2026-10-13.md:79`. |
| C11-45 | Lab 9: evidence record per student and an evidence table | evidence snapshot per case; Prepare evidence export `app/views/reviews.py:787` | verified-in-code | |
| C11-46 | Lab 10: failure-injection tests show diagnosis and targeted repair | `platform/services/core-api/tests/chapter11-escalation.test.ts`, `chapter11-diagnosis.test.ts`, `ch11/faults.ts` | verified-in-code | Suites present, not run in this pass; last recorded pass `docs/WORK_STATUS.md:15`. |
| C11-47 | Lab 12: access control and confidentiality | `core/experience-queries.ts:26`; `ch11/review.ts:343`; `ch11/service.ts:1745` | verified-in-code | Scores, signals and draft content go to the assigned mentor only. |
| C11-48 | Lab 12: evaluation metrics | `ch11/metrics.ts:47-94`; AI activity > Evaluation | verified-in-code | |
| C11-49 | Lab 13: academic, attendance and wellbeing-referral specialists with a checkable scheme | `ch11/specialists.ts:30`, `:76`; `ch11/packet-v2.ts` | verified-in-code | |
| C11-50 | Lab 14 / DoD: a real case approved by the actual mentor in one session, deployed, with dashboard and audit trail | hosted Streamlit app (private) | deferred-by-owner | Brief 10 owner action, `docs/WORK_STATUS.md:190`, `:210`; `docs/CHAPTER11_COMPLETION.md:18`. Sharing decision `docs/WORK_STATUS.md:209`. |
| C11-51 | Keep one student's data invisible to another (11.12; 11.4 #1, #4) | `core/experience-queries.ts:26`; anonymous prior references `ch11/service.ts:720` | verified-in-code | |
| C11-52 | Nothing reaches a student or family without an evidence trail and mentor review (11.12 guardrail 1) | `core/experience-queries.ts:326`; `core/data-refresh/generation.ts:123`; HoD/AI rows stripped `ch11/review.ts:343` | verified-in-code | Family sees `support_plans` only, which exist only after approval. |
| C11-53 | Plan drift: results that deviate from the locked plan are rejected (11.11 risks) | `ch11/service.ts:1214` (hash check), `:1562` | verified-in-code | |
| C11-54 | Approved plans update history for future runs (11.7 worked example) | `ch11/service.ts:720` | verified-in-code | Approved action categories only, anonymised. |
| C11-55 | Reasoning transparency (11.11 governance layer) | "Why this draft" and "How this was made", `app/views/reviews.py:1775`, `:1562` | verified-in-code | |
| C11-56 | Stakeholders include the Dean of Student Affairs (11.1) | `app/views/pages.py:81` | gap | No Dean role; the HoD workspace stands in for "HoD/Dean". See P3-4. |

## 2. Cross-cutting requirements (every worklet)

| ID | Requirement (source) | Where in the app | Status | Note |
|---|---|---|---|---|
| X-01 | Agents draft and flag; a named human approves; no autonomous consequential action (book line 6; method recap in all 15 chapters) | `core/support-commands.ts:246` | verified-in-code | Only `requireRole(faculty)` plus assigned mentor can publish. |
| X-02 | Release only after human approval, with the approver recorded (1.12, 2.12, 3.12, 7.12, 10.12, 15.12) | `faculty_decisions.faculty_person_id`; Outcomes "Decided by" | verified-in-code | |
| X-03 | Full audit log of releases and approvals (2.12, 3.12, 5.12, 6.12, 7.12, 15.12; KPI 3 in all chapters) | command ledger and `ch11_events` | verified-in-code | |
| X-04 | Never expose one person's data to another; detail access-controlled (1.12, 5.12, 8.12, 9.12, 10.12, 13.12, 14.12, 15.12) | `core/experience-queries.ts:26`; worker `sources` guard `platform/scripts/streamlit-worker.mts:339` | verified-in-code | Runtime checks in section 5. |
| X-05 | Version history and clean rollback (2.12, 4.12, 12.12, 13.12, 15.12; Lab 12 in all) | artifact versions, `ch11_publications`, restore and withdraw | verified-in-code | |
| X-06 | Flag for human review only; never auto-penalise or auto-decide (1.12, 2.12, 6.12, 7.12, 9.12, 10.12) | `ch11/engine.ts:371` (`reviewRequired`) | verified-in-code | |
| X-07 | Show method, source and reasoning behind every score (5.12, 8.12, 9.12, 14.12, 15.12) | Risk view signal table; Policies page; citation chips | verified-in-code | |
| X-08 | Keep drafts separate from published output; never present provisional as final (8.12, 14.12, 15.12) | draft tables vs `support_plans`; "Based on earlier figures" `app/views/freshness.py:30` | verified-in-code | See C11-25 for the stale-draft approval message. |
| X-09 | Validation is a hard gate; bounded retry; escalate with diagnosis (Labs 10, 11 and risk table in all) | as C11-21 to C11-23 | verified-in-code | Surfacing gap in C11-22. |
| X-10 | Plan locked before work begins (pseudocode conventions in all) | `ch11/service.ts:467`, `:1214` | verified-in-code | |
| X-11 | Log inputs and outputs; checkpoint before risky steps; resume (Lab 6 in all) | `ch11/service.ts:993`; `ch11/lease.ts` | verified-in-code | |
| X-12 | Human edits and overrides are effortless and logged (risk table "Over-automation" in all) | edit form `app/views/reviews.py:1901` | gap | Edits are logged (`support.draft_edited`) but limited, see C11-13. |
| X-13 | Evaluation metrics recorded (Lab 12 in all) | `ch11/metrics.ts` | verified-in-code | |
| X-14 | Dashboard shows artifact, metrics and audit (Lab 14 in all) | Reviews; AI activity > Evaluation, Audit and replay | verified-in-code | |

## 3. Gaps to fix

**P1** (breaks a DoD item or exposes an unapproved draft): none found. No code path gives a student or parent a draft: plans exist only after `decideSupportCase` approves (`core/support-commands.ts:318`) and the family read filters on visibility and current evidence. The only DoD item not met is the real-case session (C11-50), which is deferred-by-owner.

**P2** (deviation from the spec, or a wrong number or flow), most important first:

1. P2-1 Stale-figures drafts can be approved. Block approval when the draft's evidence predates the current data generation (`core/support-commands.ts` near `:300`, reuse `caseEvidenceCapturedSql`/`loadGenerationClock`) and, in `app/views/reviews.py:1840-1898`, disable "Approve and publish" for `evidence_current == False` with "Review again with the latest figures". UI and Core change only; student 021's case data stays untouched.
2. P2-2 Mentor edits: make the Action and Owner columns read-only in the edit form (`app/views/reviews.py:1916-1945`; drop "Student" from the edit options, `app/common.py:53`), and if per-action adjustment is wanted, let the mentor remove an action or swap it for another catalogue action of the same specialist; record "override" as decline plus a new review if that is the intended mapping.
3. P2-3 Escalations: add a "Needs your decision" section to Today (`app/views/mentor.py:459`) listing the mentor's `needs_human` and `ai_unavailable` jobs from `review_overview`, each linking to its plan's Diagnosis.
4. P2-4 Mentor trends: render `render_review_trends(review)` under Mentees > Outcomes (`app/views/mentor.py:566-568`); the Core already scopes trends to the mentor.
5. P2-5 Data model: add informational fields (LMS quiz scores; internship registration and evaluation; placement readiness, applications and interview outcomes) to `core/data-refresh/generator.ts:372` and `core/lms-queries.ts:186`, and show them in Source records; scoring can stay as it is.
6. P2-6 Core authority wider than the UI: `editDraft` and `recordOutcome` accept the HoD (`ch11/review.ts:40`, `:184`), and `recordOutcome` with any status other than withdrawn re-shows a withdrawn plan (`:240`). Restrict both to the assigned mentor and route re-showing through `restoreVersion`.
7. P2-7 HoD prompt: the spec lets the HoD prompt the coordinator (11.4 #0). Either record "mentor only" as an owner decision under Standing decisions in `docs/WORK_STATUS.md`, or allow a HoD-created department plan that each mentor must lock.

**P3** (cosmetic or wording):

1. P3-1 Add a one-click "Withdraw this plan" button with a short reason prompt in `render_outcomes` (`app/views/reviews.py:1167-1200`).
2. P3-2 An already-open student or parent page shows a withdrawn plan for up to 60 s; skip the read cache for the `student` action in `app/common.py:118-164`.
3. P3-3 Read the active term code instead of the fixed "2026-ODD" (`ch11/service.ts:579`, `:581`, `:650`, `:816`).
4. P3-4 Name the HoD workspace "Department head / Dean" or state the mapping in `docs/` (`app/views/pages.py:81`).
5. P3-5 `docs/WORK_STATUS.md:211` still says the hosted path uses "rules"; the rule-based path was removed (E2E C1, `docs/E2E_TEST_LOG.md:38`).
6. P3-6 The approval confirmation says "and their parent" even when the parent link lacks the support grant (`core/experience-queries.ts:51`); reword to "and any parent with access".

## 4. Runtime checks for the orchestrator

Run locally on 8503 against the local database (`docs/WORK_STATUS.md:42`). Approve, decline, edit, withdraw and restore are writes. Never sign in as, select or decide for student 021 or parent 021. Use two different flagged students whose drafts show no "Based on earlier figures" note: student A for approve, student B for decline. Note both register numbers first.

**All workspaces (role guard)**
- Sign-in form, Workspace = Mentor, student account: "This account cannot enter the selected workspace."
- Signed in as a student, open `/reviews`: "This page is in another workspace" with "Go to my home page".
- Signed out, open `/support-plan`: sign-in form, then lands on that page after sign-in.

**Student A and parent A, before the decision (no draft may be visible)**
- Student > Overview: "Support plan" reads "None yet" or "Being reviewed"; no plan card. My support plan: "Nothing here yet" or "Your mentor will review your plan again with the latest figures." Courses, Learning, Profile: no draft text, score, band or signal names.
- Parent > Overview and Support plan and mentor updates: same as above; only linked children in the picker.

**Mentor (mentor of A and B)**
- Today: "Next decision" card shows the highest-risk draft with "Flagged for ..."; Review opens Reviews > Drafts at the gate with that draft selected; "Also waiting (N)" lists the rest.
- Mentees > Risk view: "Students evaluated" is at most the assigned count; one row per student; each flagged expander shows signal, source, value, threshold, points and the review-path line.
- Drafts at the gate, student A: summary, "What happens next", "Why this draft" with citation chips, "How this was made" with all four checks passed and the model name.
- Edit, change one word of the summary, reason of 12 or more characters, Save new draft version: "A new draft version was saved"; version 2; "This version includes edits by the mentor account"; checks still pass.
- Edit again, change an action label (or set Owner to Student): expect an error naming `CATALOGUE_OR_DOMAIN_MISMATCH` (or `ADVISOR_REVIEW_REQUIRED`); nothing saved. This confirms C11-13.
- Rationale under 8 characters, Approve and publish: error, nothing saved.
- Valid rationale, Approve and publish: confirmation "Share this plan with <A> and their parent?"; Cancel: nothing saved, gate count unchanged.
- Approve and publish again, then "Yes, approve and publish": toast "Approved and published: ..."; A leaves the gate; gate count and Today drop by one; Mentees > Outcomes shows A as Planned, Visible Yes, Decided by the mentor, with the rationale.
- Student B, rationale, Decline: saved at once with no confirmation ("Decision saved against the displayed draft version."); B leaves the gate; no plan in Outcomes.
- Outcomes: Download intervention log CSV opens a file with the same rows. Choose A, "Withdraw plan", reason of 12 or more characters, Save outcome: Visible No. Then "Restore version 1": Visible Yes and a new version 2 in the publication history.
- Start a review (makes model calls; skip if quota matters): vague request such as "check my weak mentees", Save: at least two clarifying questions; answer, save, Lock review plan, Run review: agent trace stepper; for a flagged student the Mentor gate button opens that draft. A plan with an escalated student shows "Needs your decision" and a Diagnosis expander here, and Today does not list it (confirms C11-22).

**Student A and parent A, after the decision**
- Within 60 s (or after a reload): Overview shows one plan card; My support plan shows the edited summary, "What happens next", the "Drafted by AI, checked by your mentor" caption and "Why this plan was suggested". Parent sees the same under Support plan and mentor updates.
- After the withdraw step: the plan disappears; after restore it returns.
- Student B and parent B: no plan anywhere after the decline.

**Department head**
- Overview: "Students in scope", "Drafts waiting for a mentor", Flagged students list with Mentor, "Where it stands" and "Drafted by", and no score, band or draft text; trend charts (outcomes per cycle, average risk by band, with band averages hidden for groups under 3).
- Students: open a student with a draft waiting: "Support plan drafted, waiting for the mentor" with no content; Support plans lists approved plans only, A included after approval.
- Mentors: workload table; Policies: read-only, no approve control.
- No Approve, Edit, Decline, Create a review plan or Save outcome control anywhere.

**AI activity (operations account, then the HoD account in this workspace)**
- Runs: one row per student's latest review (about 320 checked, drafted count matches the gate total), "What happened" sentences, "Open replay" (operations only) opens Audit and replay and reports a match.
- Agent graph: the Mentor gate step reads "Waiting on <mentor> since ..." with no decide button. Evaluation: counts with totals ("N of N"), per-student results with no score or band. Plans: read-only.
- HoD in this workspace: same pages, no replay button.

**Learning (LMS)**
- Student account: only its own courses, assignments and submissions. Mentor account: only courses it teaches; no other student's submission content outside those courses.
