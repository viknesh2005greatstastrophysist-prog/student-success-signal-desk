# ADR-001: Deterministic spine with one bounded LLM composer

**Status:** Accepted
**Date:** 2026-09-02
**Deciders:** Project team

## Context

Chapter 11 asks for four-source collection, support prioritisation, agent orchestration, and mentor approval. The domain is high consequence. A multi-agent scoring system would add opaque failure modes without improving the core job: assembling verified evidence for human review.

## Decision

Use Python/Pydantic contracts, a LangGraph control graph, SQLite domain events and checkpoints, parallel typed fixture collectors, deterministic scoring, one optional schema-constrained LLM composer, deterministic validators, bounded named-field repair, a mandatory mentor interrupt, and a Streamlit review desk. The application is synthetic-data-only and operates offline through a deterministic generator when no model credential is available.

## Options considered

| Option | Complexity | Auditability | Domain risk | Decision |
|---|---:|---:|---:|---|
| Multi-agent scoring and intervention | High | Low | High | Rejected |
| Deterministic case manager only | Low | High | Low | Retained as baseline/fallback |
| Deterministic spine plus one LLM composer | Medium | High | Controlled | Selected |
| Predictive student-risk model | High | Low without institutional evidence | Unacceptable | Out of scope |

## Trade-offs and consequences

- Generated prose cannot change priority or invent actions; this reduces apparent autonomy and increases real control.
- SQLite is ideal for a local capstone and unsuitable for multi-tenant institutional deployment without a migration and row-level access controls.
- Streamlit makes the review workflow inspectable quickly. It is not the final integration architecture.
- Domain events remain the audit authority; LangGraph checkpoints remain runtime recovery state. Mixing these would turn recovery mechanics into business history.
- The LLM path is implemented but cannot be truthfully smoke-tested without a provider credential. Offline completion remains fully functional.

## Revisit triggers

Institutional data authorisation, multiple concurrent institutions, policy validation by education experts, or evidence that splitting the composer improves the pre-registered failed-case metric by at least 25% without safety regression.
