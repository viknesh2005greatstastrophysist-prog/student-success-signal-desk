# AURA multi-portal architecture

**Status:** approved implementation baseline

**Scope:** synthetic Chapter 11 demonstration

**Delivery constraint:** one developer, six weeks

## Decision

AURA is five independently deployed websites over one institutional core:

1. Student Portal
2. Parent Portal
3. Faculty Portal
4. HOD Portal
5. AI Governance Console

Separate websites provide independent origins, sessions, navigation, releases,
and failure isolation. They do not create separate copies of student records.
The Core API remains the sole authority for domain commands and permissions.

## Runtime topology

```text
Student Portal ----\
Parent Portal ------\
Faculty Portal ------> signed OIDC token -> private Core API -> PostgreSQL
HOD Portal ---------/                           |
AI Governance -----/                            +-> audit and artifacts
                                                 |
                                                 +-> transactional outbox
                                                        |
                                                        v
                                                governed agent worker
```

Better Auth operates as the OAuth 2.1/OIDC authorization server. Each portal is
an administrator-managed confidential client with its own exact redirect URIs
and portal-local session. The Core API accepts one protected-resource audience
and never trusts a client-supplied role or identity header.

## Authority boundaries

| Component | May do | Must not do |
|---|---|---|
| Portal server | Authenticate, request a scoped view, submit typed commands | Authorize a domain action or access the database |
| Core API | Authorize, validate, transact, emit outbox and audit records | Delegate authority to portal UI state |
| Agent worker | Read frozen synthetic evidence, run policy, compose and validate a proposal | Change academic facts, approve support, or contact a person |
| Assigned faculty | Correct owned academic records and approve or reject an exact proposal | Approve another faculty member's case or stale evidence |
| HOD | Operate within one department | Read credentials, sessions, or unrelated department data |
| Governance operator | Run synthetic scans, inspect traces, replay and export evidence | Approve support or edit academic records |

## Data ownership

- Identity and relationships: accounts, institutional roles, department scope,
  faculty assignments, parent links, field permissions, expiry, and revocation.
- Academic records: course offerings, registrations, attendance, marks, and
  versioned corrections.
- Finance read model: seeded fee status and synthetic receipt references only.
- Student support: cases, evidence references, faculty decisions, and approved
  support plans.
- Governance: run state, model mode, validation, bounded repair, fallback,
  lineage, audit, replay, and evidence exports.

## Governed workflow

```text
DETECTED -> SNAPSHOTTING -> DATA_BLOCKED | POLICY_READY
POLICY_READY -> COMPOSING -> VALIDATING
VALIDATING -> REPAIRING (maximum one named-field attempt) | AWAITING_FACULTY
REPAIRING -> AWAITING_FACULTY | DETERMINISTIC_FALLBACK
AWAITING_FACULTY -> APPROVED | REJECTED | EXPIRED | SUPERSEDED
```

Policy, eligibility, permissions, and transitions are deterministic. The LLM
may compose cited language only. Approval binds the actor, evidence-version
vector, policy version, prompt/template version, model configuration, and final
artifact hash. Approval, support-plan creation, audit, and outbox emission occur
atomically. Any relevant source change supersedes the proposal.

Replay reads recorded artifacts and never calls the model, queues work, or
repeats an external effect.

## Claim boundary

The project demonstrates a governed agentic workflow with bounded LLM
assistance. It does not demonstrate a predictive student-risk model,
administrator-proof immutability, educational impact, production readiness,
real payment processing, or autonomous academic decision-making.
