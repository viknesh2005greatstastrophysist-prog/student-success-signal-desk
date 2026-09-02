# Multi-portal prerequisite audit

**Audit date:** 2026-09-02 IST

## Ready

- Node.js 22.23.2 and npm 10.9.8 satisfy Next.js 16 requirements.
- Python 3.12.14 is available through `uv` for the existing Python/LangGraph
  reference runtime.
- Git remote read/write authentication works.
- Vercel CLI authentication works for the existing account.
- An existing Neon/PostgreSQL connection is available.
- A Better Auth secret exists locally.
- Better Auth 1.7.2 and `@better-auth/oauth-provider` 1.7.2 support a central
  OAuth 2.1/OIDC server with administrator-managed clients and PKCE.
- A separate Git worktree and branch isolate this rebuild from the unfinished
  single-portal Better Auth/design changes on `main`.

## Created by this setup

- Five independent Next.js application workspaces.
- A central auth-server workspace boundary.
- Shared typed portal contracts and visual primitives.
- An executable five-portal acceptance contract.
- An automated prerequisite checker.
- Separate Vercel project targets for each portal and the auth service.

## Not required for the local or hosted synthetic MVP

- A purchased custom domain. Separate `vercel.app` origins are sufficient.
- A real payment gateway.
- Real college APIs or student data.
- A paid LLM. Deterministic fallback is a release requirement.
- Kubernetes, microservices, Redis, or multiple databases.

## Personal actions required only for claims beyond the MVP

| Desired claim | Personal action |
|---|---|
| Custom college subdomains | Purchase/control a domain and approve DNS changes |
| Successful live Vercel AI Gateway execution | Add the payment method required by Vercel, or supply another funded model credential |
| Real institutional pilot | Obtain university approval, SSO metadata, API access, privacy review, retention rules, and authorised data processing terms |

None of these blocks building and deploying the synthetic multi-portal MVP.
