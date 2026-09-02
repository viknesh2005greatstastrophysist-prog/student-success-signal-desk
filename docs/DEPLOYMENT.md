# Deployment runbook

## Target

Streamlit Community Cloud, connected to a GitHub repository. The entry point is
`src/student_success/ui/app.py` and Python is pinned in `runtime.txt`.

The deployed build uses synthetic fixtures and the deterministic composer by
default. `OPENAI_API_KEY` is optional and must only be entered through the
platform's encrypted secrets interface. Never commit it.

## Release

1. Run `uv run pytest` and `uv run ruff check .`.
2. Push the reviewed commit to the deployment branch.
3. In Streamlit Community Cloud, deploy
   `src/student_success/ui/app.py` from that branch.
4. Wait for the build to finish and open the public URL.
5. Verify `/\_stcore/health` returns `ok` and complete the smoke checks below.

## Smoke checks

- The Ecosystem Map loads a six-student synthetic cohort on a cold database.
- AURA Coordinator can open Command Centre, Agent Operations, and Governance.
- Faculty Mentor 01 can open assigned cases and the intervention ledger.
- Synthetic Student 0001 sees only its approved support and source status.
- HoD/Dean receives aggregate metrics without student or case identifiers.
- `SYN-0005` remains visibly data-blocked for the correction demonstration.
- `SYN-0002` shows validator rejection and targeted repair in Replay.
- A mentor approval creates intervention records and the decision is audited.
- Refreshing the page preserves data while the current instance remains alive.

## Persistence boundary

The hosted SQLite files live on ephemeral instance storage. A restart or rebuild
may reset the demo, after which it seeds itself again. This is deliberate for a
synthetic educational deployment. Production use would require an external
transactional database, institutional identity, access control, and a formal
data-governance review.

## Rollback

Use Streamlit's app settings to redeploy the previous known-good Git commit. If
the current build cannot boot, temporarily point the app back to the prior commit
or revert the release commit and push. Because hosted data is synthetic and
ephemeral, rollback does not require a data migration.
