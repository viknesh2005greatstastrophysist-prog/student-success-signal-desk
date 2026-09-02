# Chapter 11 requirements traceability

Every lab maps to an implementation artifact and verifiable evidence. The source chapter is an instruction source, not an authority to preserve technically unsafe mechanics.

| Requirement | Implementation | Verification evidence |
|---|---|---|
| `CH11-LAB-01` | `CaseRequest` strict schema and scoped case creation in `contracts/models.py` and `application.py` | Invalid real-reference test; idempotent request test |
| `CH11-LAB-02` | `FixtureConnector`, `GovernedConnector`, and `PriorityEngine` | Connector scope test; policy property tests |
| `CH11-LAB-03` | Reusable `PriorityEngine`, `PacketGenerator`, and `PacketValidator` contracts | Same components pass medium, high, and low synthetic cases |
| `CH11-LAB-04` | Immutable `snapshots`, `events`, `artifacts`, and separate LangGraph checkpoint database | Restart/resume acceptance test; audit exports |
| `CH11-LAB-05` | One governed connector exposes academic, LMS, internship, and placement sources | Parallel/sequential equivalence test |
| `CH11-LAB-06` | SQLite checkpoints, event idempotency keys, repair budgets, thread IDs | Duplicate request/decision and restart tests |
| `CH11-LAB-07` | Explicit LangGraph branches for data block, draft, validation, repair, fallback, interrupt, and close | AC-01 through AC-10 |
| `CH11-LAB-08` | Four-worker `ThreadPoolExecutor` fan-out and guarded fan-in | Controlled timing test proves parallel output equality and lower wall time |
| `CH11-LAB-09` | `EvidenceClaim.source_refs`, record index, signal alignment, reason coverage, unknown disclosure | Unknown and misaligned citation fault tests |
| `CH11-LAB-10` | Named-field `merge_named_patch`, bounded repair loop, retry-exhaustion fallback | Unsafe-once and always-unsafe acceptance traces |
| `CH11-LAB-11` | `student-success` CLI for create, run, correct, decide, reopen, revoke, rollback, export, and evaluate | CLI demo command generated the curated runtime |
| `CH11-LAB-12` | Assigned-mentor guard, durable interrupt, edit revalidation, revoke, reopen, rollback, immutable decisions | Authority, unsafe mentor-edit, revoke, rollback, and restart tests |
| `CH11-LAB-13` | Separate versioned policy, catalogue, and prohibited-action YAML packs | Loader validation and policy boundary tests |
| `CH11-LAB-14` | Streamlit Queue, Evidence, Review, and Replay desk | App startup test plus browser-rendered screenshots |

## Curated trace inventory

- Normal completion: `artifacts/traces/CASE-7629D4C90D.json`
- Stale-source block, bundled correction, and resume: `artifacts/traces/CASE-315DDB9CA0.json`
- Deliberate unsafe-output detection and targeted repair: `artifacts/traces/CASE-119358D74B.json`

The deliberate unsafe fixture is labelled `test_fault_injection`. It is not represented as output from a live language model.
