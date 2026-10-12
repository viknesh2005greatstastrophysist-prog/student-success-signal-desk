# Hosted college project release plan

12 October 2026. The user explicitly approved uploading named college records behind individual account logins to the existing six AURA Vercel URLs. This supersedes the local-only delivery scope. The previous hosted demo remains a rollback target.

## Release

1. Verify eight existing Vercel project targets and production environment metadata. Preserve current deployment identities and old database schemas.
2. Add a separate hosted-college-project realm with password login, fixed dedicated database schemas and HTTPS service boundaries. Local project remains loopback-only. Disable public sign-up and legacy reset/population in the hosted realm. No account role comes from the browser.
3. Create new hosted Core and Identity schemas in the existing approved PostgreSQL instance. Copy the reviewed 321-student dataset and operational/review history into the new Core schema; copy password hashes and account subjects into the new Identity schema, without sessions, OAuth tokens or encrypted local signing keys. Provision production PKCE clients.
4. Deploy the eight services as production candidates without assigning stable domains. Check build health, security headers and unauthenticated source denial. Promote the coherent release and exercise actual six-role logins, source scopes, mentor publication/outcome, LMS, receipts and replay. Roll back affected components on failed acceptance.
5. Record live release identities, tested paths, account handover and source provenance. Keep private exports, secrets and browser traces outside the deployment source package.

## Model boundary

Local Qwen cannot be reached directly by Vercel. No hosted model credentials are currently configured. Verify current Vercel Gateway eligibility before claiming cloud inference. Existing local-model outputs can be retained with their true execution lineage; future hosted model reviews need a funded reachable provider or eligible Gateway. Failure remains an explicit validated rule path. No payment method, new credit purchase or public laptop tunnel is authorized.

## Completion

The stable URLs must serve the college project behind individual login. Anonymous raw-source requests and wrong-role/peer access must fail. Claim actual hosted model inference only if exercised successfully; otherwise name the precise remaining provider requirement. Reissue the presentation guide for these live accounts after acceptance. Budget ceiling remains 30%; account reading at hosted-work start was 14%.
