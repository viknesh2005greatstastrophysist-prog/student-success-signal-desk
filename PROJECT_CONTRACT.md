# Project contract

> **Multi-portal branch notice:** portal topology, HOD visibility, parent
> relationships, authentication, and the executable journey in this file are
> superseded on `multi-portal-architecture` by
> `docs/MULTI_PORTAL_ARCHITECTURE.md` and
> `docs/FIVE_PORTAL_ACCEPTANCE_CONTRACT.md`. The synthetic-data, deterministic
> authority, bounded-LLM, faculty-gate, audit, replay, evaluation, and claim
> boundaries below remain in force.

**Contract:** `student-success-contract-v1`
**Policy:** `demo-policy-v1`
**Dataset:** `synthetic-cohort-v1`
**Scope:** fictional educational demonstration only

## Product sentence

For a synthetic student-support programme, the system collects four authorised signal groups, identifies incomplete or concerning records using a transparent fictional policy, assembles source-linked case packets, proposes only approved support actions, pauses for mentor judgement, creates an intervention ledger only after approval, presents a self-scoped student view, provides aggregate-only leadership intelligence, and preserves a replayable audit trail.

## Non-goals

The system does not predict failure, diagnose wellbeing, contact students, alter institutional records, learn policy from outcomes, compare students, or claim educational impact or fairness. It must never use real student data without a separate institutional governance process.

## Authority

- Runtime: collect scoped fixtures, calculate priority, validate, checkpoint, and emit events.
- Case Packet Agent: explain supplied evidence and select catalogue actions. It cannot score, approve, contact, or mutate.
- Assigned mentor: approve, edit and approve, reject, revoke, or reopen an assigned case.
- Assigned intervention owner: schedule, progress, complete, cancel, and record a synthetic outcome for approved support.
- Synthetic student: view only that identity's published support plan and source-update status.
- HoD/Dean: view aggregate operational trends without student-level records.
- Demo administrator: create synthetic cases, apply bundled fixture corrections, and change policy through versioned files.

## Data contract

Four sources are exposed through one governed connector: `academic`, `lms`, `internship`, and `placement`. Every record is one of `present`, `missing`, `stale`, `contradictory`, or `not_applicable`. Academic and LMS are required. Their freshness windows are 30 and 14 days. Missing, stale, or contradictory required data blocks drafting.

Numeric thresholds in `policies/demo-policy-v1.yaml` are fictional software inputs, not research findings.

## Durable lifecycle

Only these business states exist:

`CREATED -> COLLECTING -> DATA_BLOCKED | DRAFTING -> VALIDATING -> AWAITING_MENTOR -> CLOSED`

- `DATA_BLOCKED -> COLLECTING` requires a corrected source override.
- `VALIDATING -> DRAFTING` is allowed only for a named-field repair while the retry budget remains.
- `AWAITING_MENTOR -> CLOSED` requires the assigned mentor and an idempotent decision nonce.
- `CLOSED -> AWAITING_MENTOR` requires an assigned mentor, a reason, a new artifact version, and a new review checkpoint.
- Duplicate idempotency keys return the existing result and do not repeat effects.
- Approved catalogue actions are written to the intervention ledger in the same transaction as the mentor decision. Rejected cases create no interventions.

Intervention delivery is separately guarded:

`PLANNED -> SCHEDULED -> IN_PROGRESS -> COMPLETED`

`PLANNED | SCHEDULED | IN_PROGRESS -> CANCELLED`

Completed and cancelled records are terminal. Only the assigned intervention owner may update them, and every update is appended to the case audit trail.

## Generation and validation

The operational generator receives only the normalised snapshot, deterministic priority assessment, catalogue, policy, and output schema. Every evidence claim must cite supplied records and use an emitted reason code. Proposed support must use catalogue IDs. Validators check schema, priority, citation existence, signal-to-reference alignment, unknown disclosure, catalogue eligibility, prohibited language, and state guards. Only named failing fields may be regenerated, for at most two attempts. Exhaustion produces a deterministic fallback and a visible diagnosis.

## Acceptance cases

| ID | Expected outcome |
|---|---|
| AC-01 | Fresh academic/LMS concern reaches a valid mentor interrupt. |
| AC-02 | Missing academic data reaches `DATA_BLOCKED`; no generator call. |
| AC-03 | Stale LMS data reaches `DATA_BLOCKED` with freshness reason. |
| AC-04 | Contradictory academic data is preserved and blocks drafting. |
| AC-05 | Not-applicable optional sources do not create a missing penalty. |
| AC-06 | A punitive/direct proposal is rejected and repaired or escalated. |
| AC-07 | Repeated unsupported output produces fallback plus diagnosis. |
| AC-08 | Mentor rejection closes without an approved intervention. |
| AC-09 | Revoke/reopen preserves the prior decision and creates a new version. |
| AC-10 | Restart/resume creates no duplicate collection, artifact, or decision. |

Generated tests cover threshold equality, freshness equality, null fields, duplicate events, invalid actors, and policy version changes.

## Evaluation contract

Compare the same frozen cases under: deterministic templates, an isolated LLM with no repair, and governed LLM generation with validators, repair, durable human review, and fallback. Blind packet order where human reviewers are used. Record factual corrections, citations, policy/catalogue corrections, decision time, major rewrites, acceptance, retries, latency, and cost.

The LLM is promoted only if the pre-registered usability measure improves over the deterministic baseline while prohibited-action count remains zero and unsupported claims do not meaningfully increase. Otherwise it is removed. Without enough human reviewers, results are labelled exploratory usability observations.

## Requirement evidence

| Requirement | Evidence target |
|---|---|
| CH11-LAB-01 | Typed, revisable case request and authorisation guard |
| CH11-LAB-02 | Governed collectors and deterministic calculations |
| CH11-LAB-03 | Reusable planning and packet contracts |
| CH11-LAB-04 | Separate run state, snapshots, and immutable history |
| CH11-LAB-05 | One connector exposing all four sources |
| CH11-LAB-06 | Checkpoints, budgets, audit events, and resume |
| CH11-LAB-07 | Explicit guarded graph branches |
| CH11-LAB-08 | Real parallel fan-out/fan-in with equivalence test |
| CH11-LAB-09 | Field-level source references and unknowns |
| CH11-LAB-10 | Failure diagnosis and bounded named-field repair |
| CH11-LAB-11 | CLI build command and validation report |
| CH11-LAB-12 | Permissions, human gate, revoke, reopen, rollback |
| CH11-LAB-13 | Versioned policy and intervention packs |
| CH11-LAB-14 | Queue, Evidence, Review, and Replay UI |

## Definition of done

All ten acceptance cases pass; every transition is guarded and replayable; no unsupported or prohibited proposal is presented as valid; mentor actions work after restart; deterministic fallback works without a model; audit export is complete; evaluation output is stored rather than invented; UI and CLI run from documented commands.
