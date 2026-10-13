# Chapter 11 agentic briefs 11–16

13 October 2026. Follows `CHAPTER11_GAP_BRIEFS.md` (Briefs 1–10). Source of truth: Chapter 11 of
`~/Downloads/Agentic_AI_15_Worklets_14Lab_Build_Book.docx`. Start these only after Briefs 1–9 are reviewed,
committed and redeployed.

## Why these briefs exist

The governance harness is strong: locked plans, checkpoints, a validation gate, the mentor gate, rollback and audit.
But the model does almost nothing:

- `validatePacket` (engine.ts) accepts a summary only if it is word-for-word one of the template strings. Citation
  statements and action labels must also match fixed text exactly. The model can only pick a template sentence,
  choose and order catalogue actions, and set `dueInDays`.
- `project-composer.ts` reuses one model answer per signal pattern: the full cohort run made 2 model calls for 321 students.
- Planning has no model: there are fixed missing-field questions, and `applyPlanningFeedback` parses `focus:`
  lines with a regex.
- The model never calls tools. Code fetches everything in a fixed order.
- The hosted model sees only trigger codes and placeholder citations.

The manual's method is that agents draft and flag, validation is a hard gate, and a named human approves. These
briefs give the model real agency (Labs 1, 2, 5, 8, 9, 10, 13) **inside** the existing gates. Nothing here weakens
the mentor approval gate, scope checks, exact-artifact approval, the no-direct-contact rule, or audit.

## Ground rules (all briefs)

Everything in `CHAPTER11_GAP_BRIEFS.md` still applies: ₹0, no billing, preserve records, additive migrations,
Student 021 stays pending, a separate commit per brief, honest updates to `CHAPTER11_COMPLETION.md`.

### Hosted model providers (owner decision: Groq first, Gemini fallback)

Use a provider chain behind the existing OpenAI-compatible adapter. Choose the chain per role through server
configuration only; never take it from the browser.

| Role | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Drafting, investigator, planner, specialists, diagnoser | Groq `qwen/qwen3.8-27b` (same family as local Qwen) | Gemini Flash-Lite (current key) | Labelled deterministic path |
| Judge (Brief 14) | Groq `openai/gpt-oss-120b` (a different model, for independence, with its own quota) | Gemini Flash-Lite | Deterministic rubric only |

- **Key status (13 Oct, 21:24 IST):** `GROQ_API_KEY` is in the private root `.env` (owner-only permissions,
  git-ignored). It was checked with one `GET /openai/v1/models` call: HTTP 200, and both `qwen/qwen3.8-27b` and
  `openai/gpt-oss-120b` are available. No completion calls have been spent yet.
  - The root `.env` filters credential-vault entries out of the worker environment, so allowlist
    `GROQ_API_KEY` for the model adapter only.
  - When wiring the hosted app, add it to the Streamlit secrets in the same section format the app already uses,
    and tell the owner where it went.
- **Configuration:**
  - Base URL `https://api.groq.com/openai/v1`.
  - Read the key from `GROQ_API_KEY` in the private `.env` and Streamlit secrets. The owner creates the key and
    pastes it in. Never print it, log it or commit it.
  - Keep the Gemini settings as they are.
- **One account and one key per provider.** Do not rotate keys across multiple accounts or projects to exceed free
  limits; Google's API terms forbid circumventing usage limits. Using Groq's separate per-model quotas as
  designed is fine.
- **Account:** free plan only, no card, no billing. If the Groq console offers Zero Data Retention in Data Controls,
  record whether it is enabled; the owner turns it on.
- **Groq constraints** (verify on console.groq.com/docs before building; limits change):
  - Free limits are per organization and per model, roughly 30 requests/min, about 1,000 requests/day,
    **8K tokens/min** and 200K tokens/day. **Tokens per minute is the binding limit.**
  - Budget each call: compact anonymised context, `max_tokens` sized to the schema, no prior-output echo.
  - A token-aware limiter is needed per model. On 429, honour `retry-after`, then move to the next provider in
    the chain.
  - Strict `json_schema` structured outputs are supported on `qwen/qwen3.8-27b` and `openai/gpt-oss-120b`, but
    **not together with tool use in the same request**.
  - So the Brief 12 investigator runs tool-calling turns without `response_format`, then makes one final
    structured-output call (no tools) to produce the packet-v2 draft.
  - If a model returns reasoning or thinking content, decode it with the existing `decodeModelContent` handling.
- **The egress contract below applies to every remote provider, Groq and Gemini alike.** Groq's better data terms
  are not a reason to send more.
- **Traceability:**
  - record the provider, model, fallback reason and token usage (when returned) per call in the Brief 5 metrics;
  - show "provider: Groq qwen3.8-27b" or "fell back to Gemini: rate limit" in the AI Activity trace.
- **Volume policy:**
  - best-of-3 (Brief 14) only for cases explicitly selected for full review, which is the demo set;
  - bulk cohort runs use N=1;
  - per-provider daily caps: `CH11_GROQ_DAILY_TOKEN_CAP` (default 180000, leaving headroom under 200K) and
    `CH11_REMOTE_DAILY_CAP` (Gemini).
- **Tests:** use the mock server to simulate a Groq 429 and check that fallback happens and is labelled. Spend only
  a handful of real Groq and Gemini calls on hosted verification.

### Privacy egress contract for all remote models (owner decision: anonymised numbers)

Build this first, as part of Brief 11. Every hosted-model request in Briefs 11–16 must pass through it, whichever
provider serves it.

- **One outbound serializer** (for example `lib/chapter11/egress.ts`). It builds every remote payload from an
  **allowlist**. Nothing else may call the remote model.
- **May leave the server:**
  - a per-run random case alias (`case-7f3a`), never a student ID, SRN or account ID;
  - numeric values: attendance %, mark %, inactivity days, overdue count, missed milestones, risk score, signal points;
  - policy thresholds and weights;
  - course **aliases** (`course-1`…`course-n`, mapped per run);
  - relative time ("week 6 of term", "12 days ago"), never calendar dates;
  - catalogue action codes and labels;
  - specialist instructions;
  - anonymised prior-intervention summaries (Brief 8);
  - validator failure codes.
- **Must never leave:**
  - names, SRNs or register numbers, emails, phone numbers;
  - parent or mentor identity, the college or department name;
  - free-text notes, raw workbook cells or cell references;
  - exact dates, internal UUIDs.
- **Server-side restoration:** aliases in model output are mapped back to real course codes and evidence paths only
  after validation.
- **Egress guard:** before every send, scan the serialized payload for SRN/register patterns, email/phone patterns,
  any roster name or surname from the in-scope cohort, and UUIDs. Refuse to send on any match and record
  `EGRESS_BLOCKED` with the matched category, never the value.
- **Audit:** record the payload hash, field list and byte size of every outbound request.
- **Local Qwen (loopback)** may keep receiving full context, as today.
- **Tests:**
  - a property test that fuzzes cases with realistic names and SRNs and asserts no egress;
  - a test that a planted name in any field is blocked.
- **Free-tier limits:** a configurable requests-per-minute limiter and a daily call cap
  (`CH11_REMOTE_DAILY_CAP`), backoff on 429, and labelled fallback when the cap is hit. Never enable billing.
  Check the current Gemini OpenAI-compatible docs for tool-calling and JSON-schema support before building on them.

### Shared engineering rules

- Version the packet schema (`packet-v2`). Old artifacts must still render and verify.
- Add every new agent to the Brief 9 graph spec as a named node with recorded state:
  `PlannerAgent`, `InvestigatorAgent`, the specialists, `CandidateJudge`/`Selector`, `Diagnoser`.
- Extend Brief 5 metrics with model calls, tool calls, tokens (when reported), latency, candidates generated,
  judge scores, egress blocks and fallback reasons.
- **Make the agency visible:**
  - in **AI Activity**, show the per-run trace: tool calls (name, aliased arguments, result size), candidates
    and scores, diagnoses, the selected candidate;
  - on the mentor draft, show a compact "How this draft was produced" panel.
- **Testing:**
  - use a local mock OpenAI-compatible server (deterministic fixtures) for unit and integration tests;
  - use local Qwen for local end-to-end;
  - spend only a handful of real Gemini calls on hosted verification.
- If a model, tool or judge step fails, use the existing labelled deterministic path. Never fall back silently
  and never auto-advance past the mentor gate.

## Brief 11: Grounded drafting instead of template picking (Lab 9; do first)

Goal: the model writes a personalised, evidence-cited draft; validation checks the claims, not exact strings.

- **New packet-v2 fields:**
  - `rationale`: 2–5 sentences, each `{text, citations: [evidencePath…]}`;
  - `actions`: each `{code (catalogue only), personalisation: text, talkingPoints: [text], dueInDays, citations}`;
  - `prohibited` stays.
  - Action **types** stay limited to the approved catalogue; the model personalises within them.
- **Claim-level validator** (replaces the exact-match checks for v2):
  - every rationale sentence and personalisation cites ≥1 valid evidence path in the frozen snapshot;
  - every number in any text equals a cited value or threshold (allow a declared rounding tolerance);
  - every course alias exists;
  - every trigger signal is covered by at least one citation;
  - length limits;
  - the existing unsafe/diagnosis/contact/guarantee checks;
  - an output PII scan (no names or SRNs, even after restoration in the model text).
- The template stays as the labelled fallback.
- **Mentor view:** model text with clickable citation chips that show the cited value and threshold.
- **Acceptance:**
  - for a flagged case, the draft names the specific driver (for example "attendance in course-2 fell to 58% vs
    the 75% threshold"), restored to the real course code for the mentor;
  - an injected ungrounded number, uncited sentence or diagnosis phrase is rejected;
  - the egress tests pass.

## Brief 12: Tool-using investigation agent (Labs 2 and 5)

Goal: the model decides what to look up before drafting, through the connector, under budget.

- **Read-only function-calling tools** over the connector, all keyed by case alias, resolved server-side within
  the actor's scope and frozen evidence revision, and returning anonymised numbers:
  - `get_attendance_breakdown(by: course|week)`
  - `get_assessment_breakdown(component)`
  - `get_lms_timeline(weeks)`
  - `get_internship_status`
  - `get_placement_activity`
  - `get_similar_prior_interventions(k)` (Brief 8 retrieval)
  - `get_policy`
- **Loop limits:** at most 3 model turns and 6 tool calls per case. Every call is audited (tool, aliased args,
  result hash). Tool results are appended to the evidence snapshot with their own evidence paths, so Brief 11
  citations can reference them.
- No write tools. No tool can reach another student, raw cells or identity.
- If the provider lacks tool support, it pre-fetches the standard set (today's behaviour), labelled.
- **Acceptance:**
  - traces show the model choosing different tools for different signal patterns;
  - a citation to a tool result validates;
  - an out-of-scope alias or extra call beyond the budget is refused and audited.

## Brief 13: Coordinator planning agent (Lab 1)

Goal: a real clarify → plan → revise loop from free text.

- `PlannerAgent` turns a request like "check my mentees whose attendance dropped this month" into a
  schema-validated plan draft: student filter (resolved server-side to in-scope students), domain or specialists,
  policy, steps.
- **Planning tools:**
  - `count_my_students(filter)` returns only aggregate counts and aliases;
  - `list_policies` returns approved policy IDs and summaries.
- **It asks clarifying questions specific to the request.** For a vague request it must ask ≥2 that refer to the
  actual ambiguity (for example "this month" vs "since mid-term"; which policy).
- It revises the **same** plan revision from natural-language feedback (Brief 7 path). The regex parser stays only
  as a fallback.
- The mentor sees the resolved student list (real names, rendered server-side), edits and locks. The planner can
  never lock, execute or widen scope.
- **Acceptance:**
  - three different vague requests each produce request-specific questions;
  - feedback in plain English ("leave out final-years, focus attendance") changes the plan;
  - an attempt to include out-of-scope students is impossible by construction.

## Brief 14: Parallel best-of-N with a judge (Lab 8)

Goal: generate several candidates per flagged student in parallel and select by plan alignment.

- **Candidates:** N=3 per flagged case (configurable; drops to 1 when the free-tier limiter or daily cap
  requires), in parallel: one per relevant specialist (Brief 15), or varied temperatures when there is a single
  specialist.
- **Validation:** all candidates go through the Brief 11 validator. Invalid candidates are logged, never selected.
- **Scoring:**
  - a deterministic rubric: signal coverage, citation density, plan alignment (domain and policy), specificity;
  - an anonymised model-as-judge rubric (alignment to the locked plan, actionability, tone appropriate for a mentor
    conversation) with a short justification.
  - The judge can only rank valid candidates. It cannot override validation or the human gate.
- Select the highest combined score. Record all candidates, scores and the selection reason. The mentor can view
  runner-ups.
- **Retire cross-student profile reuse** (`project-composer.ts`) for cases going to mentor review. Each reviewed
  student gets their own generation. Keep reuse only for an explicitly labelled bulk dry-run, if at all.
- **Acceptance:**
  - measured quality (rubric score and judge score) of best-of-3 vs single candidate on a fixed fictional test set;
  - wall-clock parallel vs sequential on the real path;
  - both recorded in the completion ledger.

## Brief 15: Specialist agents (Lab 13)

Goal: real domain specialists, not one generic prompt.

- **A registry of specialist agents**, each with its own system prompt (use the existing `instruction` fields),
  allowed tools, catalogue subset and extra output checks:
  - **Attendance specialist:** patterns by course and week, timing of the outreach conversation.
  - **Academic specialist:** CIE components, remediation actions, LMS assignment follow-up.
  - **Wellbeing-referral specialist:** may only propose a mentor check-in and a counsellor referral. It has a
    stricter language validator (no diagnosis, labels, speculation about causes) and never sees more than the
    triggering signals.
  - **Optional career specialist** (internship/placement milestones), if it fits the catalogue.
- **Routing:** the coordinator routes by the case's signals. Several specialists may contribute candidates
  (Brief 14), and the selector merges by plan alignment.
- **Acceptance:**
  - each specialist has fixture tests showing domain-correct output that passes its own checks;
  - the wellbeing specialist rejects diagnostic language and any non-referral action.

## Brief 16: Diagnosis agent in the repair loop (Lab 10)

Goal: the agent diagnoses the exact failing constraint and repairs only that part.

- On validation failure, `Diagnoser` gets the failing check codes plus only the offending fragments (anonymised).
  It returns a plain-language diagnosis and a targeted patch instruction.
- The regenerator receives the diagnosis and regenerates only the failing sentences or actions. Passing parts are
  kept byte-for-byte.
- Diagnoses are stored and shown in the validation report.
- When the budget is exhausted, escalate to the mentor with the diagnosis (builds on Brief 4).
- **Failure-injection tests:** an ungrounded number, a missing trigger citation, diagnostic language, a
  wrong-domain action code, an over-length rationale, and a PII string in the output.
- **Acceptance:** each injected fault is diagnosed correctly and repaired within budget, or escalated with an
  accurate diagnosis. Unaffected parts are unchanged.

## Order and reporting

Do 11 (with the egress contract) → 12 → 13 → 14 → 15 → 16. If time runs short, 11 + 12 give the largest gain;
stop after any completed brief, since each is independently useful.

For each brief, report: done / partial / skipped, files changed, tests run with results, remote calls and tokens spent
per provider (Groq and Gemini), egress test results, and what the AI Activity trace shows. Redeploy only after local verification. Keep the hosted app
private until the owner decides on sharing.
