# gstack browser verification

Status: DONE_WITH_CONCERNS. The installed gstack router and browse workflow were used. Fable provided planning and plan revision. No gstack autoplan, outside model review, deployment or shipping workflow was executed.

## Actual coverage

The Aside integration was unavailable, so the documented fallback used gstack's own headless Chromium. Its browser dependency check initially failed because the skill installation lacked Playwright modules. The existing project Playwright installation was linked into the skill runtime; the browser check then passed. No browser package or extension was added to the user's normal browser.

The browser opened its own local pages at ports 3101 through 3106. Every guest entry returned HTTP 200 and presented a Sign in link. Snapshot evidence is in private `runtime/project-final/gstack-guest-evidence.json`. Entry screenshots were read visually. The AURA entry layout, typography, spacing and sign-in affordance rendered correctly.

Console evidence for the guest checks contained seven instances of `Failed to load resource: the server responded with a status of 401 (Unauthorized)`. These came from protected overview requests in unauthenticated entry pages. They are expected authentication responses, not JavaScript exceptions. Authenticated application exception checks belong to the separate actual-account Playwright acceptance harness.

Authenticated actions were exercised by the project's own Playwright harness, not by gstack typing passwords. See the final report for their results. Native screens were reviewed from private screenshots. No cross-browser baseline or manual screen reader assessment was established.

## Durable operating lessons

- Better Auth's sign-in limit needs more than ten seconds between automated project account logins. Keep the limit enabled and pace acceptance logins at twelve seconds.
- A rotation of Better Auth's encryption secret also requires invalidating its encrypted local JWKS and sessions. Changing only the secret leaves token issuance unable to decrypt the signing key.
- Filesystem paths derived from URLs containing spaces must use `fileURLToPath`. A URL pathname contains escaped spaces and is not a filesystem path.
- Guest overview 401s are expected; use actual authenticated flows to assess service failures.
- Wait for data loading and finite entry animations before visual/a11y evidence. Capture redaction after the UI has settled.

These lessons stay in this project documentation. No Codex global memory was updated. The user opted into anonymous aggregate gstack usage statistics. Artifact synchronization was verified off; student data and project files were not authorized for telemetry upload.
