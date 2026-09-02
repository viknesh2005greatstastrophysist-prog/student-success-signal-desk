# Deployment runbook

## Target

Vercel hosts the responsive Next.js application and authenticated API routes.
Clerk provides signup/login and Neon Postgres holds the shared, versioned
synthetic ledger. Both services are connected through Vercel Marketplace.
Vercel AI Gateway supplies the bounded composer through deployment OIDC.

The Python/Streamlit implementation remains a local reference runtime. It is not
the public web target because Streamlit relies on a long-lived WebSocket server,
which is not the execution model of Vercel Functions.

## Release

1. Pull the linked development variables with `vercel env pull .env.local`.
2. Apply schema migrations with `npm run db:migrate` using the unpooled Neon URL.
3. Run `npm test`, `npm run test:db-invariants`, `npm run lint`, `npm run build`, `npm audit`, and `uv run pytest -q`.
4. Deploy a preview with `vercel deploy` and complete the smoke checks below.
5. Attach a domain owned by the project operator to Vercel. Clerk production
   instances cannot use a `*.vercel.app` domain.
6. Configure Clerk's production instance and required DNS records. Verify that
   `pk_live_` and `sk_live_` keys, not development keys, are attached only to
   Vercel's production environment. Never copy the secret into source control.
7. Confirm AI Gateway has an explicit budget and no automatic top-up. A card may
   be required by Vercel to unlock included free credits; this is an operator action.
8. Promote with `vercel deploy --prod`.
9. Create at least two prototype accounts, assign one Operations and one Mentor,
   and repeat all smoke checks at laptop and 390 × 844 mobile viewports.

## Smoke checks

- The landing, signup, login, and protected dashboard render without horizontal
  overflow at laptop and phone widths.
- An unauthenticated `/api/ecosystem` request is denied before application data is returned.
- The Ecosystem Map loads a six-student synthetic cohort from Postgres.
- AURA Operations can open Command Centre, Agent Operations, Governance, and read-only previews.
- Faculty Mentor 01 can open assigned cases and the intervention ledger.
- Synthetic Student 0001 sees only its approved support and source status.
- HoD/Dean receives aggregate metrics without student or case identifiers.
- `SYN-0005` remains visibly data-blocked for the correction demonstration.
- The labelled `SYN-0004` red-team fixture injects predictive language, which the critic rejects before one bounded repair.
- A mentor approval creates an intervention atomically and the decision is audited.
- Running a synthetic cycle adds collector, data-quality, policy, bounded LLM composer,
  validator/repair, human-interrupt, and completion events.
- The run reports `governed-llm`, not fallback, and the audit contains model-run and artifact IDs.
- Replay verifies stored artifact hashes and explicitly does not rerun the model.
- Refreshing or opening another browser preserves the shared state.

## Persistence and identity boundary

Neon Postgres persists the synthetic demonstration state across deployments.
Each Clerk user ID has one server-owned prototype role. Operations preview is
read-only and does not change the authenticated actor's permissions. These are
still synthetic assignments, not institutional identities. A real pilot requires
university SSO, authoritative student/parent/faculty relationships, reviewed
provisioning, revocation, retention rules, and approved institutional source APIs.

## Rollback

Use Vercel's deployment history to promote the previous known-good deployment.
Application rollback does not roll back Neon automatically. For schema changes,
apply a tested forward migration or restore from Neon's retained history. The
single-row demo ledger can be reset from the authenticated coordinator surface.
