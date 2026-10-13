# AURA Streamlit app

One app, six role-specific college workspaces. Password accounts, data, audit and agent workflows use the existing authoritative AURA PostgreSQL records through a private server worker. The browser never supplies trusted roles or database credentials.

## Local launch

From the repository root, with the existing private project database running:

```sh
.venv/bin/streamlit run streamlit_app/app.py --server.address 127.0.0.1 --server.port 8501
```

Use the existing project account passwords in the private login card. Student and LMS share an identity. The app reads local configuration from `runtime/project-final/environment.json`, or the explicit `AURA_STREAMLIT_ENV_FILE` path. Configuration files and passwords stay outside Git.

Rebuild the worker after changing Core code: from `platform/`, run `node scripts/build-streamlit-engine.mjs`. The bundled engine contains code only, no database, model weights, account credentials or imported college exports.

## Streamlit Community Cloud

Deploy this directory's `app.py` on a tested repository branch. Its own `requirements.txt` installs Python dependencies. Configure the `[aura]` section in Advanced settings using the private dedicated remote database settings. The example file contains placeholders only. Keep the app private while testing and then retain individual password entry. Persistent writes stay in PostgreSQL; app restarts do not reset the cohort.

The server uses Node 22. If the host has an older Node version, it downloads a pinned official Linux runtime and verifies the vendor checksum. No paid service or billing activation is required by this bootstrap.

Local Qwen inference works only while the laptop's model endpoint is running. A cloud app cannot call that local endpoint. With no hosted model configured, reviews use the explicit validated rule path. Stored local-model history preserves its execution mode and lineage. Do not describe it as new cloud inference.

Original reporting periods and source meanings remain unknown. Generated operations are separate from raw supplied attendance/CIE values. Project payment records do not collect money.
