# Local setup and reproducibility

The hosted demonstration can be used without installing the source. To run a separate local installation, use Node 22.12 or newer and a PostgreSQL database that you are authorized to use. No database credential is included in the submission.

From the repository's `platform` directory:

```sh
npm ci
cp .env.example .env.local
```

Edit the ignored `.env.local` file. Supply the database URLs and replace the placeholder values for `BETTER_AUTH_SECRET`, `PORTAL_SESSION_SECRET` and `DEMO_PERSONA_PASSWORD`. Generate independent random secrets of at least 32 characters. Keep the example's separate `aura_identity_local` and `aura_core_local` schemas and `AURA_CLIENT_PROFILE=local`.

```sh
npm run initialize:local
npm run dev:local
```

The initializer creates missing schemas and tables, seeds a synthetic institutional generation only when none exists, provisions the five public PKCE clients, and links the five demo identities to Core people. Repeating initialization preserves the institutional generation. It refuses production schema names. Local registrations use loopback callbacks in a separate identity schema; production registrations use HTTPS web callbacks. Do not repurpose the deployed identity schema for a fresh local installation.

Open Faculty at `http://127.0.0.1:3103` or Governance at `http://127.0.0.1:3105`. Choose Enter portal; no PIN is required. Student, Parent and HoD run on ports 3101, 3102 and 3104. Identity is on 3200 and Core on 3300. The root environment is passed to all workspaces; it does not need to be copied into each app.

## Optional local model

If Ollama and a compatible model are already available, set `CH11_MODEL` to the installed model name and `CH11_MODEL_BASE_URL=http://127.0.0.1:11434/v1` in the private environment before starting the services. The recorded acceptance used `qwen3.8:27b-mlx` on the project owner's machine. The project does not automatically download that model. Without a configured model, select the clearly labelled rule-based mode.

## Verification

The credential-free lab build and unit tests run without PostgreSQL:

```sh
npm run chapter11:build
npm run test:core
```

`npm run check` also builds the identity service and therefore needs valid private environment values. Run it with the root environment loaded:

```sh
node --env-file=.env.local node_modules/turbo/bin/turbo run lint typecheck build --env-mode=loose
node --test tests/*.test.mjs
npm run test:core
```

Database and browser acceptance tests reset synthetic data. Use a separate test installation with schema names beginning `aura_core_test_ch11` and `aura_identity_test_`, and consult the test files for the required environment flags. Never point destructive acceptance tests at an institutional dataset.
