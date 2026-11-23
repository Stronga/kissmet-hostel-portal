# Cloudflare Foundation

## Scope

Phase 1 creates a Cloudflare-native application alongside the legacy Django project. The Django application remains untouched and continues to serve only as the migration reference.

## New Structure

```text
cloudflare/
  .dev.vars.example
  migrations/
    .gitkeep
  package.json
  src/
    index.ts
    repositories/
      database.repository.ts
    routes/
      health.routes.ts
    services/
      health.service.ts
    types/
      bindings.ts
  tsconfig.json
  wrangler.toml
```

## Runtime

- Cloudflare Workers
- Hono
- TypeScript
- Cloudflare D1 binding: `DB`
- Cloudflare R2 binding: `DOCUMENTS`

## Wrangler version

The Worker toolchain is **Wrangler v4** (`wrangler@^4.166.0`) with `@cloudflare/workers-types@^5` (v5 is a peer of current Wrangler 4; dated entrypoints such as `@cloudflare/workers-types/2022-11-30` were removed). Node 16 and 18 are not supported; use Node 22 LTS. Check the version with `npx wrangler --version` (`wrangler version` was removed).

Breaking changes reviewed from the [v3 → v4 migration guide](https://developers.cloudflare.com/workers/wrangler/migration/update-v3-to-v4/):

- Commands that can run locally or remotely now **default to local**. Add `--remote` only when the command should touch the Cloudflare account (never run `--remote` without owner approval). This repo already passes `--local` or `--remote` explicitly on every D1 script. `wrangler kv key` and `wrangler r2 object` used to default to remote in v3; they are not used in this repo, but any future use must pass `--remote` to reach production data.
- Removed: `legacy_assets`, `node_compat` (use the `nodejs_compat` compatibility flag), `usage_model`, `getBindingsProxy()` (use `getPlatformProxy()`), `wrangler publish` (use `wrangler deploy`), `wrangler generate`. None of these were in this project.
- Bundling uses esbuild 0.24+: wildcard dynamic `import()` can pull in every matching file. This Worker does not use wildcard dynamic imports.
- `wrangler dev` is local by default (`--remote` is opt-in). The `dev` script still passes `--local --env local`, which remains valid. `dev:remote` is `wrangler dev --env staging` and is **still local** unless you add `--remote`; do not add that flag without approval.
- Config file remains `wrangler.toml` (JSON/JSONC is optional, not required).

`wrangler types` can generate `worker-configuration.d.ts` from the config. This project keeps a hand-written `Env` in `src/types/bindings.ts` (secrets and optional vars that are not all declared in the TOML), so types stay on `@cloudflare/workers-types` v5 rather than a generated `Env` that would collide.

Useful **local-only** checks (no account login, no deploy):

```bash
npx wrangler --version
npx wrangler deploy --dry-run --env local
npx wrangler d1 migrations list DB --local --env local
```

Do not run `wrangler d1 migrations list --remote` against production without a separate, reviewed plan: that command can create a tracking table if it is missing.

## Wrangler Configuration

`cloudflare/wrangler.toml` defines three environments:

- `local`
  - Worker name: `kissmet-hostel-api-local`
  - D1 database: `kissmet-hostel-local`
  - R2 bucket: `kissmet-hostel-local-documents`
  - Base URL: `http://localhost:8787`
- `staging`
  - Worker name: `kissmet-hostel-api-staging`
  - D1 database: `kissmet-hostel-staging`
  - R2 bucket: `kissmet-hostel-staging-documents`
  - Base URL: `https://staging-api.kissmetgroup.org`
  - D1 `database_id` is a placeholder until the real Cloudflare resource is created.
- `production`
  - Worker name: `kissmet-hostel-api-production`
  - Route: `api.kissmetgroup.org/*`
  - D1 database: `kissmet-hostel-production`
  - R2 bucket: `kissmet-hostel-production-documents`
  - Base URL: `https://api.kissmetgroup.org`
  - D1 `database_id` is a placeholder until the real Cloudflare resource is created.

## Migration System

An empty D1 migration directory now exists at:

```text
cloudflare/migrations/
```

No hostel tables have been created yet. Schema work starts in a later phase.

Useful commands:

```bash
npm run db:migrations:list
npm run db:migrations:apply:local
npm run db:migrations:apply:staging
npm run db:migrations:apply:production
```

## Environment Configuration

Non-secret environment values are defined in `wrangler.toml`.

Local secret placeholders are documented in:

```text
cloudflare/.dev.vars.example
```

No secrets are required for this foundation phase.

## Repository and Service Layers

The new Workers app includes foundation folders for database access:

- `src/repositories/database.repository.ts`
  - Owns D1 connectivity checks.
- `src/services/health.service.ts`
  - Owns health response composition.
- `src/routes/health.routes.ts`
  - Owns HTTP health routes.

No hostel feature repositories or services have been added yet.

## Endpoints

- `GET /`
  - Returns service metadata and available foundation endpoints.
- `GET /health`
  - Returns application health and environment metadata.
- `GET /health/db`
  - Runs `SELECT 1 AS result` against D1 and returns database connectivity status.

## Local Run

From `cloudflare/`:

```bash
npm install
npm run typecheck
npm run dev
```

The local Worker runs on Wrangler's local dev server, normally:

```text
http://localhost:8787
```

Verified locally on `http://127.0.0.1:8787`:

- `GET /` returned service metadata and endpoint list.
- `GET /health` returned application health for the `local` environment.
- `GET /health/db` returned D1 connectivity success from `SELECT 1 AS result`.

## Guardrails

- Legacy Django files were not modified.
- No authentication migration was started.
- No hostel domain features were built.
- No D1 schema was created beyond the empty migration system.


## CORS / Allowed Origins (R12)

`ADMIN_ALLOWED_ORIGINS` lists explicit Admin and Resident browser origins (no wildcards). Local Vite ports are pinned: Admin `5173`, Resident `5174`. Production includes `https://admin.kissmetgroup.org` and `https://portal.kissmetgroup.org`.


## OTP SMS secrets (Phase 1)

Production OTP SMS uses Arkesel as transport only. Store `ARKESEL_API_KEY` with Cloudflare Worker secrets (`wrangler secret put`), never in `wrangler.toml`. Configure `SMS_PROVIDER=arkesel` and `ARKESEL_SENDER_ID` as non-secret vars after sender approval. Local defaults to `SMS_PROVIDER=mock`. See `AUTHENTICATION.md`.
