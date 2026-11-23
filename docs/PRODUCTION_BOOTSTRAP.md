# Production bootstrap (first-time reference data)

Tool: `cloudflare/scripts/bootstrap-production.mjs` (Node 22, no extra dependencies).
Config template: `cloudflare/bootstrap/production.config.template.json` (+ `bootstrap.schema.json` for editor validation).
Tests: `cloudflare/tests/bootstrap-production.test.ts` (sql.js with migrations 0001–0021; run twice → no duplicates).

**Never run `seeds/development.sql` against staging or production.** The bootstrap never reads `seeds/` and refuses
dev-seed fingerprints (example.com/.test emails, `+233000000xxx` phones, dev salts, template placeholders).

## What it creates (insert-only)

| Table | Natural key | Notes |
|---|---|---|
| `roles` | `code` | `super_admin`, `manager`, `reception`, `accounts`, `maintenance` (must match `src/auth/permissions.ts`) |
| `users` + `staff` | `username` / `email` / `phone`; `staff_code` | First super admin **only if no super_admin staff row exists** |
| `system_settings` (row 1) | `id = 1` | Only fills fields still NULL / default |
| `institutions` | `code` | Residents choosing "Other" need no row |
| `academic_sessions` | `code` | At most one `active` (DB partial unique index) |
| `lease_periods` | `code` | `academic_calendar` (may link one session), `calendar_year`, `short_term` |
| `rooms` / `beds` | `room_code` / `bed_code = ROOMCODE-LABEL` | beds ≤ capacity; labels default A, B, C… |
| `rate_cards` | `rate_code` | occupancy 1, 2 or 4; one active per lease period + occupancy |
| `room_rates` (optional) | `rate_code` | per room × academic session (session-based booking pricing) |

Every statement is `INSERT … ON CONFLICT DO NOTHING` or `INSERT … SELECT … WHERE NOT EXISTS`; nothing is updated or deleted,
so re-running is a no-op and later admin edits are never overwritten. A schema guard at the top makes the batch fail on a
database that is missing migrations up to 0021 (the guard also selects `users.must_change_password` and the `auth_rate_limits` table).

## Super admin credential

The config never contains a password. Choose one:

1. `--issue-admin-temp-password`: a random temporary password is generated, hashed exactly like the Worker
   (`pbkdf2-sha256$100000$<salt>$<hex>`), only the hash is written to the SQL, and the password is printed **once** to
   stderr. It only takes effect if this SQL actually creates the admin. Treat the generated `.sql` as sensitive and delete it
   after use.
2. No flag: the admin is created with `password_hash = NULL` (cannot log in) until a password is set.

The super admin row is always created with `must_change_password = 1` (migration 0021). The temporary password only
opens the forced "Set a new password" screen: every other staff route returns 403 `PASSWORD_CHANGE_REQUIRED` until the
admin changes it via `POST /auth/staff/change-password` (see AUTHENTICATION.md, *Staff password change & rotation*).

## Usage

```bash
cd cloudflare
cp bootstrap/production.config.template.json bootstrap/production.config.json   # gitignored
# fill in real values, then DRY RUN (default; executes nothing):
node scripts/bootstrap-production.mjs --env production --config bootstrap/production.config.json --out bootstrap/production.bootstrap.sql
# review the SQL, then — only with owner approval, after migrations 0001-0021 are applied remotely:
node scripts/bootstrap-production.mjs --env production --config bootstrap/production.config.json \
  --out bootstrap/production.bootstrap.sql --issue-admin-temp-password --apply --confirm kissmet-production
```

`--apply` refuses unless `--env` is given, `--confirm` equals the env's `database_name` in `wrangler.toml`, `--out` is set,
and the env's D1 id is not a placeholder (staging currently is). It runs
`npx wrangler d1 execute DB --env <env> --file <out> --remote` (`--local` for env local).

## Information the owner must supply

See `production.config.template.json`; every `<REPLACE …>` must be filled:

- **Organisation** (optional): display name, support email, support phone (+233…), address.
- **First super admin**: full name, login username (lowercase), work email, phone (+233XXXXXXXXX), staff code (e.g. `KSM-STF-001`), job title.
- **Institutions**: short code + full name for each listed school.
- **Academic sessions**: code, name, start/end dates, which one is active.
- **Lease periods**: code, name, kind (academic calendar / calendar year / short term), dates, status, linked academic session.
- **Rooms**: room code, optional name and floor, capacity (rate cards exist for 1, 2, 4), gender policy (female / male / any), status, bed labels.
- **Rate cards**: code, lease period, occupancy (1/2/4), amount in pesewas, optional package months, status.
- **Room rates** (only if session-based per-room pricing is still used): room, session, amount in pesewas.
- **Not covered by the bootstrap** (set in the admin UI after login): payment confirmation policy (default `full`), additional staff accounts, announcements.


## Staging synthetic seed (never production)

Staging uses `cloudflare/scripts/seed-staging-synthetic.mjs` with
`bootstrap/staging.synthetic.config.json` (`"synthetic": true`). That wrapper forces `--synthetic`,
defaults to `--env staging`, and refuses `--env production` and `--confirm kissmet-production`.
The invented rooms, prices, and staff are labelled synthetic; they are not real hostel data.

Default is a dry run. `--apply` still needs a real staging D1 id (not the wrangler.toml placeholder)
and explicit owner approval. See `docs/STAGING_PLAN.md`.
