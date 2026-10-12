# Real-college implementation and activation

Updated 12 October 2026. Active code is in `platform/`.
Requirements and practical input files are in `WHAT_I_NEED_FROM_YOU.md`.

## Current state

Six original workbooks are preserved privately, with hashes and source-cell
references. They cover 321 students and 7,265 values; CIE records cover 67
students. Unknown dates and source meanings have not been converted to estimates.
No real records have been imported into the hosted application database and no
real user login or institutional deployment is verified.

The local private workflow prepared 321 persistent clarification packets.
Two shared question profiles used two actual calls to the configured local
`qwen3.8:27b-mlx` service. Only predefined task descriptions and codes went to
the model. Student identities and raw grades did not. Deterministic code binds
facts to original cells and validates that every required question is retained.

Packets include immutable versions, source snapshots, citations, checkpoints,
bounded workers, pause/retry, local edits, follow-up records, exact-version
acceptance, withdrawal/restore and audit replay/export. Risk remains null and
student publication is blocked. Replay checks stored evidence and hashes; it
does not promise identical regenerated model output. The local operator session
is a loopback boundary, not institutional authentication. Production use is refused.

## Local review

From `platform/`, with private `.env.local` already configured:

```sh
npm run attendance:workflow -- ../runtime/college-attendance/2026-10-12/attendance.json 3503
```

Open `http://127.0.0.1:3503/`. Existing packets persist in the private import
directory. Do not expose this server through a tunnel or deploy it as a portal.
Checklist acceptance does not authorize data interpretation or student support.

## Native portal path

Every portal has `/college-records`, backed by its own authenticated BFF and
the Core `/api/v1/college-sources` endpoint. Core validates the immutable dataset
and the verified account mapping, then rechecks current assignments/grants.

| Actor | Source visibility |
|---|---|
| Student / LMS student | Own verified records |
| Parent | Verified linked students and currently granted field groups |
| Faculty / mentor | Currently assigned, verified students |
| HoD | Verified department scope |
| Governance / AI operator | Aggregate readiness without individual rows |

Access documents cannot grant scope that current database assignments revoke.
Fictional demo identities are rejected. Institutional identity mode disables the
demo sign-in path, requires verified email for managed account sign-in and blocks
synthetic reset/population, simulated payment and legacy demo-policy execution.
Account creation, email delivery/reset and optional college SSO still require
the selected operational configuration and verified roster.

## Activation sequence

1. Obtain the authorized directory, source definitions, mappings and methodology.
   Provision identities and Core people/roles/mentor/parent/department relationships
   from verified institutional evidence. This provisioning is not performed yet.
2. Use a separate private database/schema. Apply base Core/identity migrations
   without synthetic seed/reset. Never point the real rollout at public demo state.
3. Validate the completed access mapping with `import-college-vault.ts`; the default
   is check-only. `--apply` verifies already-provisioned Core subject/person/role
   bindings before writing the optional immutable source vault migration.
4. Confirm units, periods, source definitions and approved measurements. Create
   the four-source normalization batch with per-student mentor approvals and
   source record IDs. `import-college-normalization.ts` defaults to check-only;
   apply requires matching active mentor assignments. Unsupported/freeform fields,
   invalid percentages, missing required sources and unknown dates fail validation.
5. Load registrations, actual LMS content/activity, career evidence and any agreed
   academic/fee records through verified operational mappings. Source exports do
   not substitute for these records. Approve policy through the existing mentor
   workflow. The Chapter 11 runtime reads approved real evidence, uses its declared
   term, and blocks absent/stale evidence. It can use actual native LMS evidence
   after college scope is verified, or an approved normalized LMS source.
6. Configure private services and login URLs, then deploy and test real role sessions,
   parent grant revocation, cross-student denial, mentor approval and support
   withdrawal/restore. Record faculty acceptance and refresh submission evidence.

Relevant environment switches, in addition to the normal private service settings:

```dotenv
AURA_IDENTITY_MODE=institutional
AURA_PORTAL_MODE=institutional
CORE_IDENTITY_REALM=institutional
CORE_DATABASE_SCHEMA=aura_college_<approved_private_name>
AUTH_DATABASE_SCHEMA=<separate_private_identity_schema>
COLLEGE_ACTIVE_PACKAGE_HASH=<digest_returned_by_vault_import>
COLLEGE_NORMALIZATION_BATCH_HASH=<digest_returned_by_normalization_import>
```

The package digest binds review contents and account mapping. The dataset digest
also binds loaded source/identity contents; approval flags are human attestations,
not independently verified documents. Access revisions create new immutable
packages. Approved normalization must reference the active package version.
The model endpoint must be reachable from the chosen Core deployment; the local
model is not automatically reachable from a hosted service.

Example check-only commands, from `platform/`:

```sh
node --env-file=.env.local --import tsx services/core-api/scripts/prepare-college-intake.ts ../runtime/college-attendance/2026-10-12/attendance.json
node --env-file=.env.local --import tsx services/core-api/scripts/import-college-vault.ts ../runtime/college-attendance/2026-10-12/attendance.json ../runtime/college-attendance/2026-10-12/intake/access-mapping.template.json
node --env-file=.env.local --import tsx services/core-api/scripts/import-college-normalization.ts ../runtime/college-attendance/2026-10-12/intake/normalized-sources.template.json
```

## Verification boundaries

Unit tests cover raw unknowns, model repair/fallback, immutable checkpoints,
review/version lifecycle, CSRF, source hashes, role projection, revocation and
normalization gates. The optional PostgreSQL vault test uses fictional records
in a fresh schema and drops it afterwards. It is not a real institutional import.
Native portal browser tests use fictional intercepted scoped responses for
rendering and real anonymous BFF denial. They do not verify real login or deployed
identity linkage. Private pilot browser inspection reads actual persisted packets;
mutation journeys use fictional students. Axe and layout checks do not establish
screen-reader or baseline visual-regression acceptance.

Private execution logs, screenshots and cohort evidence stay under
`runtime/college-attendance/2026-10-12/`. No real records, account credentials or
raw audit exports belong in Git or the public submission package.
