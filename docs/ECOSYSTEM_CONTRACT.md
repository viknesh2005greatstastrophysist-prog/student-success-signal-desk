# Student Success ecosystem contract

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
| Command centre | Faculty mentor, coordinator | View cohort and assigned-workload summaries. No automatic action. |
| Mentor workspace | Assigned faculty mentor | Inspect evidence, approve/edit/reject packets, correct bundled synthetic records, reopen and roll back. |
| Intervention tracker | Assigned faculty mentor | Log approved support work and outcomes. It does not contact students. |
| Student portal | One synthetic student identity | View only that identity's approved support plan and source-update status. No peer comparison or risk label. |
| Leadership cockpit | HoD/Dean | View aggregate trends, data quality, and intervention outcomes. No student-level drill-down. |
| Agent operations | Coordinator | Inspect connector health, the agent graph, run events, retries, and blocked work. |
| Governance centre | Coordinator, leadership | Inspect policy, validators, model boundary, permissions, and audit exports. |

The identity switcher is a demo harness, not authentication. A production build
requires institutional SSO, role provisioning, access review, and server-side
authorization.

## Component model

```text
Synthetic Contineo ─┐
Synthetic LMS ──────┼─> governed parallel collectors ─> normalized snapshot
Synthetic internship┤                                      │
Synthetic placement─┘                                      v
                                               deterministic policy engine
                                                          │
                                                          v
                                            bounded packet composer (optional LLM)
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

Every transition ─> SQLite domain ledger + LangGraph recovery checkpoint
```

## Domain additions

- A versioned concern-index calculation accompanies the existing priority and
  reason codes. It is never presented as predictive confidence.
- Approved support catalogue items become intervention records atomically with
  an approval decision.
- Cohort runs record the coordinator, cohort, case membership, terminal status,
  completed count, blocked count, timestamps, and any failure reason.
- Intervention records move through `PLANNED`, `SCHEDULED`, `IN_PROGRESS`,
  `COMPLETED`, or `CANCELLED`, with mentor-owned notes and optional outcomes.
- Aggregate analytics deduplicate by student and use the latest case artifact.
- Connector health is derived from source envelopes and audit events; simulated
  connectors are always labelled as such.

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
| ECO-08 | The role-based Streamlit ecosystem starts from an empty database and seeds a meaningful synthetic operating state. |
| ECO-09 | Each cohort scan produces a durable coordinator run record with case membership and blocked-work counts. |

## Deployment boundary

The current cloud target uses ephemeral SQLite and synthetic fixtures. A real
pilot requires external transactional storage, SSO, encrypted secrets, approved
Contineo/LMS/internship/placement APIs, retention policy, consent/legal review,
observability, incident response, and a measured human-oversight trial.
