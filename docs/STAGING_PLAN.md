# Staging database and deployment plan

Status (2026-11-23): **configuration prepared in the repo — no Cloudflare resources were created or
changed in this work.** `[env.staging]` is `kissmet-hostel-api-staging` with `APP_ENV=staging`,
`SMS_PROVIDER=mock`, HTTPS staging CORS origins, and `workers_dev=true`. The staging D1
`database_id` is still the placeholder `replace-with-staging-d1-database-id`. The R2 bucket
`kissmet-hostel-staging-documents` is named in config only (private; do not create it until
approved). Every step below that touches Cloudflare needs owner approval.

Migration 0022 is reserved for refund records and must not be used for staging schema. Staging
migrations, when approved, are 0001–0021 only (plus the staging-only `staging_otp_inbox` table
created by the synthetic seed, not by a numbered production migration).

## 1. Separation rules

| | local | staging | production |
|---|---|---|---|
| Worker | `kissmet-hostel-api-local` | `kissmet-hostel-api-staging` | `kissmet-hostel-api-production` (route `api.kissmetgroup.org/*`) |
| D1 | `kissmet-hostel-local` (miniflare) | `kissmet-hostel-staging` (new, isolated) | `kissmet-production` |
| R2 | local | `kissmet-hostel-staging-documents` (new, private) | `kissmet-documents-production` (private) |
| SMS | mock | **mock** (default). Arkesel only if later enabled explicitly | Arkesel |
| OTP test path | `DEV_OTP_LOG` / in-process capture | `POST /staging/otp-test/lookup` (APP_ENV=staging + `STAGING_OTP_TEST_KEY`), behind Access | **impossible** (404 even if the secret is mis-set) |
| Secrets | `.dev.vars` | separate values (never production copies) | `wrangler secret put … --env production` |
| Connector | mock connector on loopback | **no** `MIKROTIK_CONNECTOR_URL` (internet access shows "not configured"). A later mock connector, if approved, uses `deploy/connector.env.staging.example` (`ROUTEROS_DRIVER=mock`) | Pi via Tunnel + Access |
| Data | dev seed allowed locally | synthetic seed only (`scripts/seed-staging-synthetic.mjs`); **never** the dev seed, never production PII | bootstrap tool with owner-supplied real config |
| Frontends | Vite dev, localhost API | Pages `kissmet-admin-staging` / `kissmet-portal-staging` built with `VITE_API_BASE_URL=https://staging-api.kissmetgroup.org` | `https://api.kissmetgroup.org` |
| Access | none | Cloudflare Access on every staging hostname | production Access as already planned for the connector Tunnel |

`TRUST_PROXY=true` stays restricted to the production trusted-proxy connector deployment
(`BIND_HOST=127.0.0.1` behind cloudflared). Staging does not set `TRUST_PROXY=true`.

## 2. Staging-only OTP test path

Resident OTPs are stored as hashes (`otp_codes.code_hash`), so they cannot be read back from D1.
Staging uses mock SMS (no text is sent). When `APP_ENV=staging`, the mock provider also writes a
short-lived plaintext row to `staging_otp_inbox` (created at first write, or by the synthetic seed).
That table is **not** a numbered production migration.

Lookup:

```http
POST /staging/otp-test/lookup
Content-Type: application/json
X-Staging-Otp-Key: <STAGING_OTP_TEST_KEY>

{"phone": "+233555010001"}
```

Guards (all required):

1. Cloudflare Access on the staging API hostname (first gate; configured only after approval).
2. `APP_ENV === "staging"` — any other environment, including production and local, returns **404**.
3. `STAGING_OTP_TEST_KEY` Worker secret must be set — otherwise **404** (path disabled).
4. Request header must match the secret (SHA-256 + timing-safe compare) — otherwise **401**.

Production is fail-closed: the route 404s even if `STAGING_OTP_TEST_KEY` or `DEV_OTP_LOG=true` is
present, `validateProductionConfig` treats a production `STAGING_OTP_TEST_KEY` as a **critical**
issue, and the inbox table is never created when `APP_ENV` is not staging. Tests in
`cloudflare/tests/staging-otp-test-path.test.ts` cover this.

Do not enable `DEV_OTP_LOG` on staging (OTPs would appear in Worker logs).

## 3. Cloudflare Access plan (approval-gated)

Put Cloudflare Access in front of every staging hostname, including the `workers.dev` URL while
`workers_dev=true`:

- `https://staging-api.kissmetgroup.org` (once the Worker custom domain/route is approved)
- `https://kissmet-hostel-api-staging.<account-subdomain>.workers.dev`
- `https://staging-admin.kissmetgroup.org` (`kissmet-admin-staging` Pages)
- `https://staging-portal.kissmetgroup.org` (`kissmet-portal-staging` Pages)

Recommended policy (adjust to the owner's identity provider):

- Application type: Self-hosted, HTTPS, for each hostname above (or a single wildcard
  `*.` policy if the zone layout allows it — still list every hostname).
- Allow policy: named emails / an Access group of approved testers only.
- Session duration: short (e.g. 24 hours).
- Optional: a Cloudflare Access service token for any later CI smoke test. The OTP test path still
  requires `X-Staging-Otp-Key` in addition to Access.
- No public bypass for `/staging/*`. A bypass for `GET /health` is optional and is a separate
  decision; default is Access on the whole hostname.

Access is configured in the Cloudflare Zero Trust dashboard (or `wrangler access` / Terraform).
Do not create applications until approved.

## 4. Create staging resources (owner approval)

Do **not** run these until explicitly approved. Account: Kissmet (`9265bd10baf9262f5fa79264e8db2d84`).

```bash
cd cloudflare
# Record the printed database_id and replace the placeholder in wrangler.toml via a reviewed PR
# (ids are not secrets).
npx wrangler d1 create kissmet-hostel-staging
npx wrangler r2 bucket create kissmet-hostel-staging-documents
# Keep the R2 bucket private: no public access, no public bucket URL, no custom domain.
```

`d1 create` / `r2 bucket create` talk to the account API. Wrangler v4 D1 execute/migrations default
to local; the apply scripts already pass `--remote` for staging/production.

Optional custom domain (after DNS): add a Worker route in `[env.staging]`:

```toml
routes = [{ pattern = "staging-api.kissmetgroup.org/*", zone_name = "kissmetgroup.org" }]
```

## 5. Secrets (staging values, generated fresh — never production copies)

```bash
# Required for the OTP test path (generate a long random value; do not commit it).
npx wrangler secret put STAGING_OTP_TEST_KEY --env staging

# Only if a staging mock connector is later approved (not required for the default setup):
# npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env staging
# npx wrangler secret put CONNECTOR_HEARTBEAT_SECRET --env staging     # >= 32 chars

# Only if SMS_PROVIDER is later switched to arkesel on staging:
# npx wrangler secret put ARKESEL_API_KEY --env staging
```

## 6. Migrations, synthetic seed, smoke test (owner approval)

```bash
# Record a Time Travel bookmark before the first apply.
npx wrangler d1 time-travel info kissmet-hostel-staging

# Apply 0001–0021 only. Do not apply a 0022 (reserved for refunds).
# Avoid `wrangler d1 migrations list --remote` unless needed: it can create d1_migrations (a write).
npx wrangler d1 migrations apply DB --remote --env staging

# Dry run the synthetic seed (safe; writes a local SQL file only):
node scripts/seed-staging-synthetic.mjs --env staging \
  --config bootstrap/staging.synthetic.config.json \
  --out bootstrap/staging.bootstrap.sql --issue-admin-temp-password

# Review the SQL, then — only with owner approval, after the real staging D1 id is in wrangler.toml:
node scripts/seed-staging-synthetic.mjs --env staging \
  --config bootstrap/staging.synthetic.config.json \
  --out bootstrap/staging.bootstrap.sql --issue-admin-temp-password \
  --apply --confirm kissmet-hostel-staging
```

The synthetic seed refuses `--env production` and `--confirm kissmet-production`. It never reads
`seeds/development.sql`. Temporary admin passwords are printed once to stderr and must be changed
at first login (`must_change_password = 1`).

Smoke test (staging only, after deploy + Access):

1. `GET /health` and `/health/db` → 200 (through Access if no health bypass).
2. Staff login with the temporary password lands on the forced "Set a new password" screen.
3. Admin: synthetic rooms/beds/rate cards visible; create a synthetic resident; request OTP; retrieve
   the code from `POST /staging/otp-test/lookup`; complete application → booking → payment → verify
   → confirm → allocation; receipt generated.
4. Resident portal: OTP login, view booking, payments, receipts, upload a test document (R2).
5. Internet access page shows connector "not configured" — no MikroTik calls from staging.
6. Unauthenticated `/admin/*`, `/resident/me/*` return 401.
7. `POST /connector/heartbeat` unsigned → 401/503.
8. `POST /staging/otp-test/lookup` from production configuration / without the key → 404.

## 7. Deploy (owner approval)

```bash
cd cloudflare
npm ci && npm test && npm run typecheck
npx wrangler deploy --env staging
```

Frontends (HTTPS API URL is mandatory; the production-mode build guard refuses missing, empty,
`http`, or localhost values):

```bash
cd admin-frontend
npm run build:staging
# build:staging copies headers/staging/_headers over dist/_headers so connect-src
# allows https://staging-api.kissmetgroup.org. Production public/_headers is unchanged.
# After the Pages project exists (approval):
# npx wrangler pages deploy dist --project-name=kissmet-admin-staging

cd ../resident-frontend
npm run build:staging
# npx wrangler pages deploy dist --project-name=kissmet-portal-staging
```

Create Pages projects (approval):

```bash
npx wrangler pages project create kissmet-admin-staging
npx wrangler pages project create kissmet-portal-staging
```

Set `VITE_API_BASE_URL=https://staging-api.kissmetgroup.org` as a Pages build variable on both
projects (see `.env.staging.example`). Attach custom domains `staging-admin.kissmetgroup.org` and
`staging-portal.kissmetgroup.org` (must match `ADMIN_ALLOWED_ORIGINS`). Then attach Cloudflare Access
as in section 3.

## 8. Rollback

- Worker: `npx wrangler rollback --env staging` (previous version) or redeploy the previous git tag.
- D1: migrations are forward-only. Use D1 Time Travel
  (`npx wrangler d1 time-travel restore kissmet-hostel-staging --timestamp <ISO>`)
  to return to a point before the migration/bootstrap; record the timestamp before every apply
  (`npx wrangler d1 time-travel info kissmet-hostel-staging`).
- Bootstrap: insert-only; to undo on staging, Time Travel restore (preferred).
- Frontends: Pages "rollback to previous deployment".

## 9. Promotion to production (separate approval)

Same sequence with `--env production`: record Time Travel bookmark → read-only migration check →
apply migrations (0001–0021 only until refund 0022 is separately approved) → bootstrap dry run with
**owner-supplied** real config (never the synthetic seed, never `seeds/development.sql`) → owner
reviews SQL → bootstrap apply → set secrets → deploy Worker → deploy frontends → smoke test with
real admin only (no synthetic residents in production).

The staging OTP test path must remain impossible in production (already enforced in code and tests).
