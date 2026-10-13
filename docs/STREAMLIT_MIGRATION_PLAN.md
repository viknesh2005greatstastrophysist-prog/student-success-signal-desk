# Streamlit migration plan

13 October 2026. The user requested local development followed by a Streamlit deployment, with ₹0 spending, and instructed all eight Vercel projects to be paused. Their pauses and public paused responses are verified in private runtime evidence.

## Decision and revised plan

One Streamlit application presents six role workspaces. Reuse the existing 321-student, 647-account PostgreSQL cohort and Core engine. A bundled Node worker handles private JSONL RPC; no public Core or Identity service is required. Existing password hashes authenticate accounts. Opaque eight-hour tokens are stored as hashes, linked to the identity session and current credential fingerprint. Every operation rebinds the active role. Account/source attempt buckets and a source ceiling limit login attempts; expired buckets are cleaned during operation. Domain relationships, parent field grants, revisions, immutable source records, exact artifact approval, idempotent commands and audit remain authoritative.

Local mode uses the dedicated local PostgreSQL schema and local Qwen endpoint. Cloud mode uses the separately pinned remote project schemas. Database credentials belong only in Streamlit secrets. Cloud cannot call the laptop model. With no hosted model configured, new reviews use the validated rule path and display their actual mode. Stored local-model history retains its mode and lineage. No card, paid plan, billing activation or public laptop tunnel is required.

Deploy code and the bundled engine only. Exclude named workbooks, parsed exports, passwords, runtime configuration, sessions and private evidence from Git. Persistent writes stay in PostgreSQL, outside Community Cloud's app filesystem. Configuration stays at repository-root `.streamlit/config.toml`; dependencies sit beside the entrypoint.

## Acceptance and evidence

Local acceptance passed all six actual account logins, 21 UI pages, source scopes, peer/staff/role-spoof denial, LMS activity and submissions, mentor edit and stale-version rejection, exact approval, Student/Parent publication, withdrawal/restore, receipts, replay and fresh four-source model execution. Attachment bytes round-trip and peer download denial passed. Nine focused authentication checks passed, including expiry, current role withdrawal, identity-session revocation and stale credential rejection. Core typecheck passed; Core tests passed 60 with six opt-in database checks skipped in this run.

Preserve presentation Student 021 pending. Cloud completion requires published source, server secrets, actual hosted startup and actual password/scope verification. Pause evidence and original source integrity remain preserved. Local acceptance alone does not prove cloud deployment.
