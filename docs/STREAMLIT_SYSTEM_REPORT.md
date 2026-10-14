# AURA system report

## Delivered system

AURA is one Streamlit application with six role workspaces: Student, Faculty, Parent, Department head, Governance and Learning. It reuses the existing PostgreSQL domain engine and password accounts. The public application source contains code, not the supplied college records or credentials. The original eight Vercel services are paused.

Live app: https://aura-college-workspace.streamlit.app/

Local app: http://127.0.0.1:8501/

## College data and unknowns

The Downloads inventory contained 12 workbook copies representing six unique supplied XLS workbooks. The imports preserve 321 student identities, 328 attendance rows, 67 CIE rows and 7,265 raw field values with file, sheet, row and cell provenance. The raw attendance/CIE values are retained separately from the generated operational records. No meaning has been assigned to 0, NA, TNS or dashes. Original reporting periods, academic year, units and CIE maxima remain unknown.

Generated operations provide coherent courses, attendance sessions, assessment/results, LMS activity, career milestones, mentoring and fee records. Their provenance remains in the system. They do not become official college facts simply because they appear beside the supplied records.

The account roster has 647 individual password accounts: 321 Student, 321 Parent, three Faculty, one HoD and one Operations account. Student identities also enter the Learning workspace. Staff/parent mappings and project credentials are created for this project; institutional ownership and relationships have not been independently verified.

## Six workspaces

| Workspace | Working functions and scope |
|---|---|
| Student | Own progress, courses, learning activity, academic records, approved support, fees/receipts and supplied source records |
| Parent | Linked child data, permitted field groups, approved support, fee attempts/receipts and scoped supplied records |
| Faculty | Assigned cohort and courses, classroom attendance/marks, mentoring follow-ups, policy approval, scoped review plans, draft edits and exact approvals, intervention outcomes |
| Department head | Department overview and classroom/mentoring oversight; support visibility without mentor approval authority |
| Governance | Pipeline operations, plan/job history, run verification and evidence exports; aggregate supplied-source visibility without individual source records |
| Learning | Lessons, activity recording, assignment submissions and attachments, feedback, authorized file downloads; staff teaching tools through the Faculty workspace |

The interface uses native Streamlit forms, tables, charts, editors, expanders and downloads. There are 21 sidebar pages across the five multi-page workspaces plus the Learning workspace. The theme uses green, ivory and clear typography. The page does not carry blanket generated/demo banners. Source-definition notes and no-money payment provenance stay visible where they affect interpretation.

## Agent pipeline

1. A mentor describes the review and may select students, a review domain and an approved mentor policy. The AI planner reads the request, resolves students from the mentor's own scope (an explicit selection is authoritative) and asks clarification questions about what is genuinely ambiguous. Every plan and review runs on AI; there is no execution-mode choice.
2. Locking freezes the scope and policy. Execution checks current authorization and persistent job state before doing work.
3. Four collectors obtain academic, LMS, internship and placement evidence. Up to four student jobs run concurrently.
4. Schema, scope, semester, freshness and completeness checks block unsupported evidence. Deterministic thresholds compute explainable risk triggers.
5. Tagged support references are retrieved with a reproducible lexical embedding. This is lexical retrieval, not a pretrained semantic embedding model.
6. Gemini 3.1 Flash-Lite chooses and orders permitted support actions and bounded due dates. Cloud requests omit names, identifiers, raw records, numeric evidence, dates and private references. Only generic trigger codes, catalogue actions and citation placeholders leave the app. Citation statements are restored by the server from frozen evidence.
7. A closed schema and evidence validator reject invented claims, unsupported citations, missing trigger coverage and forbidden authority. At most two repair attempts are allowed. Provider/quota failures use a recorded deterministic fallback.
8. A proposal enters the mentor queue. Approval names the exact artifact, content hash and revision. An outdated approval is rejected. HoD, Student, Parent and Operations accounts cannot approve mentor drafts.
9. Approved interventions become visible to the permitted Student and Parent. Mentors record progress, completion or withdrawal. Withdrawal changes publication visibility while preserving history.
10. Persistent audit, command idempotency, checkpoint exports and recorded-run verification support inspection and recovery. Verification checks saved execution evidence; it does not claim a fresh model will reproduce identical text.

Local mode retains the local Qwen model. Hosted mode uses the free-tier Gemini connection. Every result records its actual mode and model, including fallback.

## Authentication and persistence

A private server worker accepts a fixed set of JSONL actions. Browser fields never supply trusted roles. Existing Better Auth password hashes authenticate accounts. Random eight-hour session tokens are stored as SHA-256 hashes, linked to identity sessions and credential fingerprints. Expiry, credential changes, identity-session revocation and current role withdrawal invalidate access. Logout removes the session even if the role was withdrawn. Login attempts are limited by account/source with a source ceiling and expiry cleanup.

Each data operation rebinds the current active role, then the Core engine applies department, course, student, parent-link and field-grant rules. Revisions protect concurrent edits. Persistent records and audit stay in PostgreSQL across app restarts. Streamlit's shared cache contains the transport only, never a user's returned records.

The private root `.env` stores all project passwords and keys. It is mode 0600 and ignored by Git. Cloud receives only the database and model configuration needed for execution through its private secrets store. Plain account passwords are not deployed. Original exports, parsed records, environment files and private acceptance artifacts remain outside public Git.

## Verification and practical limits

Local acceptance covered six real account logins, 21 pages, source/relationship scopes, peer/staff/role-spoof denial, LMS persistence, draft editing, stale-version rejection, exact approval, Student/Parent publication, withdrawal/restore, payment records and receipts, replay and a fresh four-source Qwen review. Nine focused authentication checks and an attachment upload/download/peer-denial round trip passed.

Remote acceptance covered all six accounts and the same 13 grouped backend journeys, including fresh Gemini generation. A separate real Gemini request verified anonymous request construction and schema-valid output. Core verification passed 61 tests with six opt-in database tests skipped in this run; typecheck, Python compilation and Ruff passed. Browser evidence and final package evidence are private.

Project payment flows record simulated attempts and receipts; they do not charge a card. No real email/SMS delivery, institutional SSO, institution-approved relationship roster, verified official thresholds or paid service activation is claimed. Free Gemini quotas can cause a documented fallback. Free hosting is suitable for the college presentation; it is not a guarantee of unlimited capacity or institutional deployment readiness.

To use this with official college operations, the college must confirm source definitions and periods, real relationship assignments, account ownership and institutional thresholds. The presentation can proceed with these unknowns preserved.


The hosted browser verified all six logins, the Student source scope of one, the HoD scope of 321 and a new four-source Gemini execution ending in `awaiting_faculty`. The prepared Student021 case remains pending. A post-save refresh defect was fixed and checked with an actual save/lock AppTest. Local pause/resume RPC validation, including stale revision rejection, passed.

## Source references

- [Streamlit file organization and configuration](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/file-organization)
- [Gemini free-tier pricing and data-use policy](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
