# Chapter 11 demonstration

Use only the supplied synthetic generation. Keep the demo PIN private.

1. Open Governance. Link synthetic source fixtures. This supplies the three external signal types; academic evidence comes from the shared simulation.
2. Open Faculty, then Cases. Approve demonstration thresholds with an explanatory rationale. Explain that this is a test identity, not a real professor's approval.
3. Ask the coordinator to review students without selecting scope, focus or policy. Show the three clarification questions.
4. Select the assigned student, academic focus and approved policy. Enter revision feedback. Save and lock the plan.
5. Choose the live model on a configured local installation, or explicitly identify the rule-based cloud mode. Run the review. Show each risk trigger, execution mode and passing validation.
6. Export evidence. Show the four source records, locked plan hash, checkpoints, model attempt if used, citations and acceptance report.
7. Open the pending faculty case. Optionally change the due interval, give a reason and save a validated new draft version. Approve the exact latest artifact with a review rationale.
8. In separate Student and Parent sessions, show the approved support plan. The parent view remains controlled by the existing relationship and access rules.
9. Record an intervention outcome. Withdraw the publication and show that Student and Parent lose access. Restore the same approved plan and show it returns.
10. Open HoD Cases to show aggregate review and outcome counts. Open Governance Runs to inspect evidence and verify replay hashes.

For the lab failure demonstration, run the Chapter 11 unit and database tests. Explain the failure being injected before showing its passing assertion. Do not describe an injected provider or synthetic record as real evidence.

## Local commands

From `platform`, configure the private environment using `.env.example`, migrate the database, seed the simulation, and link the demo identities using the auth service's existing seed command. Use an isolated schema beginning `aura_core_test_ch11` for destructive acceptance tests.

```sh
npm ci
npm run check
npm run chapter11:build
CORE_DATABASE_SCHEMA=aura_core_test_ch11_browser npx turbo run dev --parallel --env-mode=loose
```

Local portal ports: Student 3101, Parent 3102, Faculty 3103, HoD 3104, Governance 3105, Identity 3200, Core 3300. PostgreSQL and private identity configuration are required for the connected portals. The credential-free lab build works independently.

## Explain it in plain English

Think of the coordinator as a teacher managing a small team. Four assistants gather different records. Another applies the agreed scoring rules. Another suggests allowed support steps. A checker rejects unsupported statements. The real teacher makes the final decision. The system remembers completed work, so a crash does not mean starting everything again.

Agents do not need separate computers or separate language models. Their defining features here are separate responsibilities, typed messages, saved state, tool use and controlled decisions. The language model handles bounded recommendation choices; arithmetic, privacy and approval remain enforced in code.
