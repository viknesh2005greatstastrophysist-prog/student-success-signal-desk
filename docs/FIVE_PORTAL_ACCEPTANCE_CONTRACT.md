# Five-portal executable acceptance contract

## Frozen journey

One seeded synthetic institution contains one department, one HOD, one faculty
member, one student, one linked parent, one governance operator, and one course.

1. HOD publishes the course and assigns the faculty member.
2. Student registers for the published offering.
3. Faculty sees the enrolment and records attendance and marks.
4. Student sees only their own academic and fee records.
5. Parent sees only fields allowed by the active relationship grant.
6. A committed academic event creates one outbox item.
7. The worker freezes evidence, evaluates deterministic policy, and produces a
   cited proposal through the LLM or deterministic fallback.
8. Faculty approves or rejects the exact current artifact.
9. Approved support becomes visible to the student and, when permitted, parent.
10. HOD sees the departmental disposition.
11. AI Governance shows lineage and verifies side-effect-free replay.

## Portal gates

| Portal | Required proof | Mandatory denial |
|---|---|---|
| Student | Register and read own records and approved support | Another student's identifier returns no data |
| Parent | Read active, field-permitted linked-student data | Self-link, expired grant, revoked field, and unlinked student fail closed |
| Faculty | Read assigned roster, amend owned records, decide owned case | Unassigned section and stale-artifact approval fail closed |
| HOD | Publish course and read department details and aggregates | Another department and auth/session data fail closed |
| AI Governance | Start synthetic run, inspect evidence, validate, replay, export | Academic mutation and faculty approval fail closed |

## System invariants

- Exactly five portal applications build independently.
- Portal tokens have distinct clients but one Core API audience.
- Core authorization ignores client-supplied role, department, and subject.
- Duplicate commands and duplicate outbox delivery cause zero duplicate effects.
- Approval compares the current dependency-version vector while holding the case
  lock and commits decision, support plan, audit, and outbox atomically.
- Revoked parent access is effective on the next request.
- Missing, stale, or contradictory required evidence blocks composition.
- Model timeout, malformed output, or failed repair produces safe fallback.
- Replay has zero writes outside the replay receipt.
- Every identifier and record passes the synthetic-provenance guard.
- Predictive, diagnostic, punitive, or direct-contact language cannot be
  presented as a valid proposal.

## Definition of done

The seeded journey passes ten consecutive runs after a clean reset. Any
authorization escape, stale approval, post-revocation disclosure, duplicate
side effect, replay mutation, unsupported claim, or unlabelled synthetic record
fails the release.
