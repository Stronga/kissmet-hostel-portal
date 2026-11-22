# Staging database and deployment plan

Status (2026-11-22): **plan only — no Cloudflare resources were created or changed.** `wrangler.toml` already has an
`[env.staging]` block (`kissmet-hostel-api-staging`, `APP_ENV=staging`, `workers_dev=true`, staging CORS origins) but the
staging D1 `database_id` is the placeholder `replace-with-staging-d1-database-id` and the R2 bucket
`kissmet-hostel-staging-documents` may not exist. Every step below that touches Cloudflare needs owner approval.

## 1. Separation rules

| | local | staging | production |
|---|---|---|---|
| Worker | `kissmet-hostel-api-local` | `kissmet-hostel-api-staging` | `kissmet-hostel-api-production` (route `api.kissmetgroup.org/*`) |
| D1 | `kissmet-hostel-local` (miniflare) | `kissmet-hostel-staging` (new) | `kissmet-production` |
| R2 | local | `kissmet-hostel-staging-documents` (new, private) | `kissmet-documents-production` (private) |
| SMS | mock | mock, or Arkesel with a separate key only when testing SMS | Arkesel |
| Secrets | `.dev.vars` | separate values (never production copies) | `wrangler secret put … --env production` |
| Connector | mock connector on loopback | **no** connector URL (internet access shows "not configured"), or a mock connector behind its own Tunnel hostname | Pi via Tunnel + Access |
| Data | dev seed allowed | bootstrap tool with synthetic config; **never** the dev seed, never production PII | bootstrap tool with real config |

## 2. Create staging resources (owner approval)

```bash
cd cloudflare
npx wrangler d1 create kissmet-hostel-staging            # prints database_id
npx wrangler r2 bucket create kissmet-hostel-staging-documents
```
Then replace the placeholder `database_id` in `[[env.staging.d1_databases]]` via a reviewed PR (ids are not secrets).
Keep the R2 bucket private (no public bucket URL, no custom domain).

## 3. Secrets (staging values, generated fresh)

```bash
npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env staging      # only if a staging connector exists
npx wrangler secret put CONNECTOR_HEARTBEAT_SECRET --env staging     # >= 32 chars
npx wrangler secret put ARKESEL_API_KEY --env staging                # only if SMS_PROVIDER=arkesel on staging
```
Staging uses the mock SMS provider unless `SMS_PROVIDER=arkesel` is set explicitly (`resolveSmsProviderName`). With mock SMS
no text is sent, so resident OTP login on staging needs either a staging Arkesel key + approved sender, or an agreed way
to read mock OTPs — decide before the smoke test (see decisions). Never enable `DEV_OTP_LOG` in production.

## 4. Migrations, bootstrap, smoke test

```bash
npx wrangler d1 migrations list DB --env staging --remote     # NOTE: creates d1_migrations if missing (a write) — fine on staging
npx wrangler d1 migrations apply DB --env staging --remote    # 0001 … 0020
node scripts/bootstrap-production.mjs --env staging --config bootstrap/staging.config.json --out bootstrap/staging.bootstrap.sql
# review, then
node scripts/bootstrap-production.mjs --env staging --config bootstrap/staging.config.json --out bootstrap/staging.bootstrap.sql \
  --issue-admin-temp-password --apply --confirm kissmet-hostel-staging
```
Smoke test (staging only):
1. `GET https://kissmet-hostel-api-staging.<account>.workers.dev/health` and `/health/db` → 200.
2. Staff login with the temporary password; Staff → reset password flow works; audit log shows `admin.staff.password_reset`.
3. Admin: rooms/beds/rate cards visible; create a synthetic resident (OTP via mock or staging SMS), application → booking →
   payment → verify → confirm → allocation; receipt generated.
4. Resident portal: OTP login, view booking, payments, receipts, upload a test document (R2), admin views it (audit row).
5. Internet access page shows connector "not configured" (no URL) — no MikroTik calls from staging.
6. Unauthenticated requests to `/admin/*`, `/resident/me/*` return 401 (covered by `tests/auth-wildcard-bypass.test.ts`).
7. `POST /connector/heartbeat` unsigned → 401/503.

## 5. Deploy

```bash
npm ci && npm test && npm run typecheck                    # in cloudflare/
npx wrangler deploy --env staging                          # owner approval
```
Frontends: build with `VITE_API_BASE_URL=https://staging-api.kissmetgroup.org` (or the staging workers.dev https URL).
The production-mode build guard (and runtime init) refuses a missing, empty, `http`, or localhost/loopback value;
`http://localhost:8787` is only a development/test fallback. Host on Cloudflare Pages projects `kissmet-admin-staging` /
`kissmet-portal-staging` with custom domains `staging-admin.kissmetgroup.org` / `staging-portal.kissmetgroup.org`
(match `ADMIN_ALLOWED_ORIGINS`). Optionally put Cloudflare Access in front of all staging hostnames.

## 6. Rollback

- Worker: `npx wrangler rollback --env staging` (previous version) or redeploy the previous git tag.
- D1: migrations are forward-only. Use D1 Time Travel (`npx wrangler d1 time-travel restore kissmet-hostel-staging --timestamp <ISO>`)
  to return to a point before the migration/bootstrap; record the timestamp before every apply
  (`npx wrangler d1 time-travel info kissmet-hostel-staging`).
- Bootstrap: insert-only; to undo on staging, Time Travel restore (preferred) — never hand-delete in production.
- Frontends: Pages "rollback to previous deployment".

## 7. Promotion to production (separate approval)

Same sequence with `--env production`: record Time Travel bookmark → read-only migration check → apply migrations →
bootstrap dry run → owner reviews SQL → bootstrap apply → set secrets → deploy Worker → deploy frontends → smoke test with
real admin only (no synthetic residents in production).
