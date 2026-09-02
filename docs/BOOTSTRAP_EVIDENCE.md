# Multi-portal bootstrap evidence

**Verified:** 2026-09-02 IST

**Branch:** `multi-portal-architecture`

**Base commit:** `439a963`

**Bootstrap commit:** `06588856fffc796f93b12de83cdaf9754a603f80`

## Isolation

The rebuild runs in `/Users/vik/Agentic AI/student-success-multi-portal` as a
separate Git worktree. The unfinished Better Auth and interface changes in the
original `main` checkout were not modified.

## Live independent deployments

| Site | Production URL | Verification |
|---|---|---|
| Student Portal | https://aura-student-portal.vercel.app | HTTP 200, independent Next.js build |
| Parent Portal | https://aura-parent-portal.vercel.app | HTTP 200, independent Next.js build |
| Faculty Portal | https://aura-faculty-portal.vercel.app | HTTP 200, independent Next.js build |
| HOD Portal | https://aura-hod-portal.vercel.app | HTTP 200, independent Next.js build |
| AI Governance | https://aura-ai-governance.vercel.app | HTTP 200, independent Next.js build |
| Identity service | https://aura-identity-service.vercel.app | HTTP 200, independent Next.js build |

OIDC discovery returns HTTP 200 at:

`https://aura-identity-service.vercel.app/api/auth/.well-known/openid-configuration`

## Identity and database

- Better Auth 1.7.2 is configured as an OAuth 2.1/OIDC provider.
- Five administrator-managed, HTTPS-only public clients use authorization code
  plus PKCE and exact production callback URLs.
- Identity tables are isolated in the additive `aura_identity` Neon schema.
- Future domain tables have a separate empty `aura_core` schema.
- The existing public schema used by the legacy deployment was not migrated or
  dropped by this setup.

## Source control and delivery

- The `multi-portal-architecture` branch is published to the GitHub origin.
- The Vercel account is connected to the owning GitHub account.
- The Vercel GitHub App can access the repository.
- Each of the five portal projects and the identity-service project is linked
  to the same repository with its own verified root directory.
- Git-triggered builds are therefore isolated per deployable even though the
  code is maintained in one monorepo.

## Local verification

- All five portal production builds: pass.
- Portal lint and TypeScript checks: pass.
- Portal contract tests: 2 pass.
- Automated prerequisite check: all entries pass.
- Central identity service lint, typecheck, and production build: pass.
- Existing Python/LangGraph reference suite: 34 tests pass.
- NPM audit: zero known vulnerabilities in the new platform workspace.

## Explicitly not proven yet

- Portal login and callback flow.
- Core API authorization and domain commands.
- Course registration, attendance, marks, fee, or parent-consent workflows.
- Transactional outbox and agent worker integration.
- Exact-artifact faculty approval and side-effect-free replay across the new
  platform.
- Successful live LLM execution.

The deployments are prerequisite shells. Treating them as a completed ecosystem
would be false.
