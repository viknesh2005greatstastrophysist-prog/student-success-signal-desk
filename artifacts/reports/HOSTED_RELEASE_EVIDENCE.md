# Hosted release evidence

Date: 2026-09-02  
Stable URL: https://student-success-signal-desk.vercel.app  
Deployment: `dpl_x1nrPctsyz36w9pocAEjknH2DnPJ`  
Git commit: `efe650c`

## Proven

| Gate | Evidence | Result |
|---|---|---|
| Vercel production deployment | Stable alias returned HTTP 200 | PASS |
| Unauthenticated API denial | `/api/ecosystem?view=operations` returned HTTP 401 and no data | PASS |
| Responsive landing | Browser viewport 1440 × 1000; document width = viewport width | PASS |
| Responsive signup | Browser viewport 390 × 844; document width = viewport width | PASS |
| Shared database | Neon Marketplace resource connected to production, preview, and development | PASS |
| Schema | Migrations 001, 002, and 003 applied to Neon | PASS |
| Server role logic | Unit tests prove Student cannot select Operations; Operations preview does not change actor role | PASS |
| Critic | Tests reject predictive language, invented evidence references, and ineligible supports | PASS |
| Mentor gate | Database test rejects intervention after rejection and accepts it after approval | PASS |
| Append-only audit | Database test rejects audit event mutation | PASS |
| Outcome boundary | Database check rejects a causal follow-up claim | PASS |
| Next application | ESLint and production Next.js build pass | PASS |
| Python reference runtime | 34 Pytest tests pass | PASS |
| Dependencies | `npm audit --audit-level=high` reports zero vulnerabilities | PASS |
| Council | Five independent advisors, anonymous peer review, chairman synthesis saved in `active/` | PASS |

## Implemented but awaiting production proof

| Gate | Current condition | Required proof |
|---|---|---|
| Production Clerk authentication | Production Vercel environment still has `pk_test_`/`sk_test_` credentials | Attach an owned custom domain, finish Clerk DNS, verify `pk_live_`/`sk_live_`, then redeploy |
| Real LLM execution | OIDC request reaches Vercel AI Gateway but returns HTTP 403 because a card is required to unlock the included free credits | Operator adds a valid card, confirms no auto top-up, then a cycle must report `governed-llm` |
| Account-bound role enforcement | Code and unit tests pass; no production user exists yet | Create Operations and Mentor accounts, provision Mentor 01, prove denied and permitted actions |
| Cross-device persistence | Shared Postgres path is deployed | Mutate with the Mentor account, refresh, sign in from a second browser/device, and observe the same version |
| End-to-end human loop | Database constraints and route code are deployed | Run cycle, mentor approve, create intervention, advance, record outcome, and replay |

## Release rule

This build is a public hosted prototype. It must not be described as production-complete until every item in the second table is demonstrated against the stable URL. The fallback composer is intentionally labelled and may not be presented as an executed LLM workflow.

