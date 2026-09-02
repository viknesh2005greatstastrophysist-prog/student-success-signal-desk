# Student Success ecosystem contract

> **Legacy single-portal contract:** this file documents the earlier Clerk
> deployment. On `multi-portal-architecture`, authentication, HOD visibility,
> fee simulation, portal topology, and the release journey are superseded by
> `FULL_COLLEGE_ECOSYSTEM_BUILD_PLAN.md`, `MULTI_PORTAL_ARCHITECTURE.md`, and
> `FIVE_PORTAL_ACCEPTANCE_CONTRACT.md`. Its bounded-AI and synthetic-data claim
> limits remain applicable.

## Purpose

The ecosystem turns four fragmented synthetic signal groups into an auditable
support workflow spanning students, faculty mentors, leadership, and operations.
It is a capstone demonstration, not an institutional production system.

The numeric output is a **fictional policy concern index**, not a probability of
failure, diagnosis, or claim about a student's future. It exists only to make the
demo policy sortable and inspectable.

## Product surfaces

| Surface | Actor | Authority and boundary |
|---|---|---|
| Ecosystem map | All demo identities | Understand the operating model and hand-offs. |
| Command centre | Faculty mentor, Operations | View cohort and assigned-workload summaries. No automatic action. |
| Mentor workspace | Assigned faculty mentor | Inspect evidence, approve/edit/reject packets, correct bundled synthetic records, reopen and roll back. |
| Intervention tracker | Assigned faculty mentor | Log approved support work and outcomes. It does not contact students. |
| Student portal | One synthetic student identity | View only that identity's approved support plan and source-update status. No peer comparison or risk label. |
| Leadership cockpit | HoD/Dean | View aggregate trends, data quality, and intervention outcomes. No student-level drill-down. |
| Agent operations | Operations | Run the synthetic graph; inspect lineage, model mode, retries, blocked work, replay, and account roles. |
| Governance centre | Operations, leadership | Inspect policy, validators, model boundary, permissions, and audit exports. |

Clerk authentication protects the deployed application and API. A server-owned
Neon profile maps each Clerk user ID to one prototype role and scope. Operations
may request read-only projections for walkthroughs, but mutations always use the
authenticated account's true role. Every provisioning change is appended to an
immutable history. A university pilot still requires institutional SSO and
authoritative provisioning/revocation.

## Component model

```text
Synthetic Contineo ─┐
Synthetic LMS ──────┼─> governed parallel collectors ─> normalized snapshot
Synthetic internship┤                                      │
Synthetic placement─┘                                      v
                                               deterministic policy engine
                                                          │
                                                          v
                                  bounded LLM composer over sanitized evidence
                                                          │
                                                          v
                                             deterministic validator + repair loop
                                                          │
                                                          v
                                               durable faculty mentor interrupt
                                                          │
                                        approved only ─────┴───── rejected
                                              │                       │
                                              v                       v
                                      intervention ledger       immutable close
                                              │
                           student self-view + aggregate leadership outcomes

Every deployed transition ─> Neon Postgres state + append-only audit/artifacts
Python reference transition ─> SQLite domain ledger + LangGraph checkpoint
```

## Domain additions

- A versioned concern-index calculation accompanies the existing priority and
  reason codes. It is never presented as predictive confidence.
- Approved support catalogue items become intervention records atomically with
  an approval decision. A database trigger rejects any other insertion path.
- Cohort runs persist the intake gate, parallel collector dispatch, each source
  collector, normalisation, policy analysis, bounded composition,
  validator/repair loop, human interrupt, and terminal state.
- Intervention records move through `PLANNED`, `SCHEDULED`, `IN_PROGRESS`,
  `COMPLETED`, or `CANCELLED`, with mentor-owned notes and optional outcomes.
- Aggregate analytics deduplicate by student and use the latest case artifact.
- Connector health is derived from source envelopes and audit events; simulated
  connectors are always labelled as such.
- Replay reconstructs the historical decision from stored sources, policies,
  prompts, model outputs, critic and repair artifacts. It never silently reruns a model.

## Acceptance criteria

| ID | Expected outcome |
|---|---|
| ECO-01 | Every role sees only its permitted product surfaces. |
| ECO-02 | A student identity cannot retrieve another student's view. |
| ECO-03 | Leadership receives aggregate records without student references. |
| ECO-04 | Mentor approval creates idempotent intervention records; rejection creates none. |
| ECO-05 | Only the intervention owner can update its status and every update creates an audit event. |
| ECO-06 | Connector health distinguishes present, missing, stale, contradictory, and not-applicable states. |
| ECO-07 | Concern index is deterministic, capped at 100, and labelled non-predictive. |
| ECO-08 | The authenticated Next.js ecosystem seeds one meaningful synthetic operating state in Postgres. |
| ECO-09 | Each cohort scan produces a durable coordinator run record with case membership and blocked-work counts. |
| ECO-10 | Refresh and cross-browser access observe the same versioned Postgres state. |
| ECO-11 | Unauthenticated ecosystem API requests fail closed before returning application data. |
| ECO-12 | Every account is scoped from its server profile; changing client parameters cannot elevate its role. |
| ECO-13 | Each run persists case, collection, snapshot, policy, model, artifact, event, and replay identifiers. |
| ECO-14 | Unsupported or predictive language is rejected and only one repair is permitted. |
| ECO-15 | Audit, role-assignment, artifact, decision, and follow-up history cannot be updated or deleted. |
| ECO-16 | Replay verifies immutable artifact hashes without rerunning the model. |

## Deployment boundary

The cloud target uses Clerk, Vercel, Neon Postgres, and synthetic fixtures. A real
pilot requires university SSO and role provisioning, approved
Contineo/LMS/internship/placement APIs, retention policy, consent/legal review,
observability, incident response, and a measured human-oversight trial.
