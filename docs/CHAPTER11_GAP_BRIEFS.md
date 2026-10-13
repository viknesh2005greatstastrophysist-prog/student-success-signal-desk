# Chapter 11 gap briefs (lab manual as source of truth)

13 October 2026. Independent code-level audit of this repository against Chapter 11 of
`~/Downloads/Agentic_AI_15_Worklets_14Lab_Build_Book.docx` (sections 11.2–11.12 and Labs 1–14).
Docs and ledgers were treated as claims; verdicts below come from the code. Line numbers refer to
commit `39b1473` and may drift slightly.

Paths: `S` = `platform/services/core-api/lib/chapter11/service.ts`, `E` = `.../chapter11/engine.ts`,
`R` = `.../chapter11/review.ts`, `P` = `.../chapter11/provider.ts`, `W` = `platform/scripts/streamlit-worker.mts`,
`APP` = `streamlit_app/app.py`, `PK` = `platform/packages/portal-kit/src/chapter11.tsx`.

## Ground rules for all briefs

- Keep ₹0 spend; no paid plans or billing. Keep secrets in the private `.env` / Streamlit secrets only.
- Preserve the 321-student / 647-account records, review history and audit rows. Additive migrations only; no resets.
- Keep presentation Student 021 pending.
- Keep every existing guardrail: scope checks, exact-artifact approval, no direct student contact, labelled fallback.
- Each brief: implement in Core first, expose it in the Streamlit app (the deployed surface), add or extend tests, and verify locally before redeploying.
- After finishing, update `docs/CHAPTER11_COMPLETION.md` honestly. Don't claim anything the code doesn't do (for example, don't say "charts" or "parallel" unless they're true).

## Priority 1: what an examiner sees on the deployed app

### Brief 1: Rebuild the 11.9 dashboard in Streamlit
Problem: the Vercel portals had the composite risk view (PK:101), but they are paused. The Streamlit jobs table (APP:1219-1229) shows only status/stage/mode/run/issue.
Do, in the Mentor workspace:
- **Composite risk view:** a table of students in the plan with risk score, band and contributing signals (code, source, value, threshold, points). Sortable, with a filter for flagged only.
- **At-risk flags with reasoning:** for each flagged student, show the signal explanations and the review path even before a draft exists.
- **Validation report:** on each draft, show the passed checks, failures and repair attempts, and whether the model or the fallback produced it.
- **Intervention log:** approved actions, outcomes, withdrawals and who decided, plus a CSV download.
Acceptance: a mentor can see score + signals + validation report + log for any in-scope student without leaving Streamlit, and peers or out-of-scope students stay hidden.

### Brief 2: Make HoD/Dean trend review real
Problem: `trends` returns only `day, reviewed` (S:330). The old HoD panel (PK:12,95) expects flagged/blocked/approved/completed/withdrawn counts, so those render as undefined. Streamlit's HoD page (APP:1909-1947) shows no trends, and there are no charts anywhere in `app.py`. `docs/STREAMLIT_SYSTEM_REPORT.md:30` claims charts.
Do: extend the trends query to give per-cycle (week or plan) counts of reviewed, flagged, blocked, awaiting approval, approved, completed and withdrawn, plus average risk score by band. Show these on the HoD page as aggregate-only charts (`st.bar_chart` / `st.line_chart` are fine) with no student drill-down. Fix the old PK panel contract at the same time.
Acceptance: HoD sees aggregate risk trends and intervention outcomes per cycle; the numbers match the database; no individual names appear.

## Priority 2: small, contained correctness fixes

### Brief 3: Run the four collectors in parallel in production (11.8, Lab 8)
Problem: S:274 runs `for (const source of sourceNames) evidence[source] = await readSource(...)` one at a time, although the plan text at E:33 says "in parallel". The parallel `collectSources` (E:214) is only used by the build script and tests.
Do: use `Promise.all` (or `collectSources` through the connector) inside the same snapshot. Make sure the shared client and transaction allow concurrent queries; if one pg client can't, use separate read connections pinned to the same revision. Record per-source timing in the checkpoint. Also: replace the fixture/sleep benchmark with a measurement of the real `executePlan` path, and add a merge/selection step that is justified by alignment to the plan.
Acceptance: production collection is concurrent, the evidence revision is still consistent, and a measured real-path comparison is recorded.

### Brief 4: Escalate to the mentor when the repair budget runs out (Lab 10)
Problem: E:199-200 silently falls back to the template after 2 repairs. Failed jobs are re-queued without limit (S:254,262).
Do: when the budget runs out, mark the job `needs_human` / `escalated` with a diagnosis (the failing checks and attempts) and show it in the Mentor queue. The template may still be offered, but labelled as such and not auto-advanced. Cap job retries. Add failure-injection tests for each of the four 11.7 checks.
Acceptance: an injected persistent fault ends in a visible escalation with its diagnosis, not a silent fallback.

### Brief 5: Evaluation metrics and real rollback (Lab 12)
Problem: no metrics code exists. "Rollback" only toggles `visible_to_student` through a withdrawn outcome (R:60) and cannot restore an earlier artifact version. In Streamlit it is a form with a 12-character reason, not one click.
Do: record per-run metrics (validation pass rate, repairs used, fallback/escalation rate, model vs rule mode, mentor edit distance or approve-as-is rate, time to decision) and show them in AI Activity and HoD. Add version history per case and a one-click "restore version N" for the assigned mentor. It republishes the earlier approved artifact as a new version, with an audit row, and keeps immutability.
Acceptance: metrics are visible per cycle; a mentor can restore a prior approved version in one action, and the student and parent see the restored plan.

### Brief 6: Let faculty set all thresholds (11.7 check 2)
Problem: the weights (20/20/20/10/15/15) and the overdue/internship/placement cut-offs (≥1) are hard-coded at E:80-85. There is no validation check for the "thresholds are faculty-set" rule, and an HoD can approve on a mentor's behalf (S:55).
Do: move all weights and cut-offs into the policy schema (additive; existing policies get today's values as explicit fields). Make them editable in the Streamlit policy form. Add validation check `thresholds_faculty_set`: the packet's policy version equals an approved policy whose approver is faculty. Decide and document whether HoD approval is allowed.
Acceptance: changing a weight in an approved policy changes the risk score, and the validation report shows the threshold check.

### Brief 7: Make the clarify, plan and revise loop work in Streamlit (Lab 1)
Problem: questions are a fixed missing-field checklist (E:26-36), `feedback` never changes the plan, and `steps` is constant (E:33). The worker exposes only `plan_save` with no id (W:255-256). Streamlit can't revise a plan, so answering means creating a new one (APP:1173-1177). `plan_pause` (W:265-266) omits `expectedRevision` and `reason`, which the schema requires (S:349), and the app never calls it.
Do: add `plan_revise` (with `expectedRevision`) to the worker and the app. Answering questions or editing the plan updates the same plan as a new revision. Show plan steps. Let feedback change the plan body (scope, domain, students, steps). Fix `plan_pause` and expose pause/resume. Optionally have the model ask request-specific clarifying questions, bounded and validated.
Acceptance: a vague request → at least 2 questions → answers revise the same plan → lock, with all of it inside Streamlit.

## Priority 3: architecture fidelity (strengthens the viva)

### Brief 8: Retrieval and connector (Labs 4 and 5)
Problem: prior interventions are read with direct SQL inside the worker loop (S:287), bypassing the connector. Only the same student's history is searched, history tags are set to the current domain (S:288), and the retrieved references are dropped from the model context (P:27-38).
Do: add a connector source `priorInterventions` (scoped and audited). Retrieve similar prior cases across in-scope students by tags and similarity, with anonymised summaries only. Pass the top-k references (anonymised) to the composer. Make `readSource` an adapter registry so a source can be swapped without changing agents.

### Brief 9: Explicit node graph, agent roster and specialists (Labs 7 and 13)
Problem: the pipeline is imperative code (S:244-316). There are no named Coordinator or Contineo/LMS/Internship/Placement collector components. The specialist `instruction` (E:125-129) is never used by the prompt (P:125).
Do: define a small graph spec (nodes plus edges, including the bounded validate → regenerate back-edge) that `executePlan` actually runs. Name the roster components to match the manual. Show the graph and per-node status in AI Activity. Make the specialists a registry and pass each pack's instruction to the composer.

## Owner action (not for Codex)

### Brief 10: Real case and real mentor sign-off (11.2 definition of done, Lab 14)
The definition of done needs a real case reviewed and approved by an actual mentor in one session. That needs authorised data and a real faculty mentor (see `docs/WHAT_I_NEED_FROM_YOU.md`). Codex must not simulate or claim this. It can prepare a one-page demo script for that session.

## Reporting back

For each brief, report: done / partial / skipped, files changed, tests run with results, the hosted verification, and anything left. Commit each brief separately.
