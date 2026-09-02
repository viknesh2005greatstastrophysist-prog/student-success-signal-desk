# Test strategy

The suite is biased toward business boundaries, not framework trivia.

| Layer | What is proved | Test type |
|---|---|---|
| Policy | Threshold/freshness equality, missingness, reason codes | Unit + property |
| Connectors | Four-source scope, fan-out/fan-in equivalence | Contract + timing |
| Validation | Citation alignment, catalogue eligibility, prohibited language | Unit + mutation-style fault injection |
| Lifecycle | Guards, idempotency, durable resume, reopen/revoke | Integration |
| Acceptance | AC-01 through AC-10 expected durable outcomes | End-to-end |
| UI | Startup, route rendering, empty and seeded states | Smoke + rendered inspection |
| Evaluation | Equal case/control inputs and honest skipped-provider status | Integration |

Coverage target is 80% branch coverage for the business/runtime package, with 100% direct scenario coverage for state transitions, mentor authority, prohibited actions, and source sufficiency. CLI dispatch and Streamlit rendering are excluded from the numeric coverage denominator and checked through dedicated smoke tests. The live model adapter is contract-tested with a fake client; a real-provider smoke test is conditional on an explicit credential.
