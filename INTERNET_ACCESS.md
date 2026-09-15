# Kissmet Internet Access — Phase 0 + Phase 1

Isolated **Internet Access** module for staff/admin provisioning of resident HotSpot identities. MikroTik enforces network entitlement; Kissmet D1 remains the source of truth for residents.

## Product boundary (LOCKED)

Core hostel flow is unchanged and must never be altered by this module:

```text
Resident → Documents → Application → Booking → Payment → Allocation / Room
```

Rules:

- Internet access is only for Kissmet residents with an **active room/bed allocation**
- Staff/admin initiates provisioning only — no resident self-service in Phase 0/1
- No internet packages; do not reuse `room_rates`, hostel payments, or accommodation statuses
- Internet failure must never corrupt registration, OTP, applications, bookings, payments, receipts, allocations, maintenance, or RBAC
- Residents do not administer MikroTik
- One identity per resident; `shared-users=3` on `Kissmet-Residents`
- MikroTik enforcement only

## Architecture

```text
Kissmet Admin UI  (/internet-access)
        │
        ▼
Cloudflare Worker / Kissmet API
        │  Authorization: Bearer <MIKROTIK_CONNECTOR_SECRET>
        ▼
Always-on MikroTik Connector  (mikrotik-connector/)
        │  WireGuard peer .5 (192.168.216.5/32)
        ▼
MikroTik 192.168.88.1:8728  (RouterOS API as portal-api)
```

**Cloudflare Workers cannot host WireGuard.** The connector must run on an always-on host that maintains the dedicated `.5` tunnel. The browser never talks to RouterOS, `192.168.88.1`, ports 8728/8729, or connector RouterOS credentials.

## Database schema

Migration: `cloudflare/migrations/0012_resident_internet_accounts.sql`

Table `resident_internet_accounts`:

| Column | Notes |
|---|---|
| `id` | PK |
| `resident_id` | UNIQUE FK → residents |
| `router_username` | UNIQUE; derived from `resident_code` |
| `router_profile` | Default `Kissmet-Residents` |
| `status` | `active` \| `suspended` \| `disabled` |
| `sync_status` | `pending` \| `synced` \| `failed` |
| `last_synced_at` | Last successful sync timestamp |
| `last_sync_error` | Safe, redacted failure message |
| `created_at` / `updated_at` | Timestamps |
| `created_by_staff_id` / `updated_by_staff_id` | FK → staff |

**No plaintext HotSpot passwords** are stored in D1. Credentials are set-once / reset and returned once to the authorized admin response.

## Username strategy

Stable mapping from Kissmet `resident_code`, e.g. `KSM-RES-0025`. Uppercased; must match `KSM-RES-[A-Z0-9]+`. Do not use Ghana Card, phone, OTP, or portal auth tokens.

## Credential strategy

- Strong random password generated server-side
- Never reuse OTP / student ID / portal auth
- Returned once on provision / reset / recreate-on-retry
- Not recoverable from D1 afterwards
- Never written to localStorage or audit metadata

## MikroTik profile

| Item | Value |
|---|---|
| Dedicated profile | `Kissmet-Residents` |
| `shared-users` | `3` (max simultaneous HotSpot sessions) |
| `default` profile | **Never modified** |

If `Kissmet-Residents` already exists with a conflicting `shared-users`, the connector fails safely (no silent overwrite). Firewall, NAT, WireGuard, DNS, HotSpot servers, and unrelated users/profiles are out of scope.

## Eligibility

Same SQL authority as resident **My Room**:

```text
Resident exists AND has allocations.status = 'active'
```

Staff/admin initiates `POST .../provision`. No auto-provision on registration.

## Lifecycle

| Action | Behavior |
|---|---|
| Provision | Create D1 row + HotSpot user; idempotent if already synced/active |
| Enable | Enable HotSpot user; idempotent if already enabled |
| Suspend | Disable HotSpot user **and** disconnect active sessions; idempotent |
| Reset password | Explicit only; returns new password once |
| Disconnect | Disconnect sessions; empty set is success |
| Retry sync | Re-push desired state; recreate missing router user if needed |
| Ensure profile | Staff action; idempotent create/verify `Kissmet-Residents` shared-users=3 |

## Sync states

| State | Meaning |
|---|---|
| `pending` | Operation accepted; awaiting / in-flight connector sync |
| `synced` | D1 desired state matches last successful RouterOS operation |
| `failed` | Connector/RouterOS unavailable or rejected; hostel data untouched |

Connector outage → internet op becomes pending/failed; hostel workflows continue.

## RBAC

Permissions (code map in `cloudflare/src/auth/permissions.ts` and admin-frontend mirror):

- `internet:read` — list/get/sessions/summary/health/eligible search
- `internet:manage` — provision/enable/suspend/reset/disconnect/retry-sync/ensure-profile

Granted to:

- `super_admin` (via `*`)
- `manager` (explicit)

Not granted to reception/accounts/maintenance/resident.

## Audit actions

- `internet.provision`
- `internet.enable`
- `internet.suspend`
- `internet.password_reset`
- `internet.disconnect_sessions`
- `internet.sync_retry`
- `internet.ensure_profile`

Password values are never audited.

## Admin API

Under `/admin` (auth + permission required):

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/internet-access` | Search + `status` + `sync_status` + pagination |
| GET | `/admin/internet-access/summary` | D1 counts: total/active/suspended/sync_failed/pending |
| GET | `/admin/internet-access/connector-health` | Non-blocking connector reachability |
| GET | `/admin/internet-access/eligible-residents` | Active allocation; shows already provisioned |
| POST | `/admin/internet-access/ensure-profile` | Staff ensure Kissmet-Residents |
| GET | `/admin/internet-access/:id` | Detail (+ room/bed + allocation flag) |
| GET | `/admin/internet-access/:id/sessions` | Live HotSpot sessions |
| POST | `/admin/internet-access/residents/:residentId/provision` | One-time password on success |
| POST | `/admin/internet-access/:id/enable` | |
| POST | `/admin/internet-access/:id/suspend` | |
| POST | `/admin/internet-access/:id/reset-password` | One-time password |
| POST | `/admin/internet-access/:id/disconnect` | |
| POST | `/admin/internet-access/:id/retry-sync` | May return one-time password if recreated |

## Phase 1 — Admin Operations & Live Connector Workflow

### Admin UI

- Nav entry **Internet Access** under **Operations** (not under Payments/Rooms), gated to `super_admin` / `manager`
- Route `/internet-access`
- Summary cards from D1 summary endpoint
- Table: resident code/name, room/bed, username, status, sync, last synced, actions
- Server-side search + status + sync filters + pagination
- Loading / empty / error + retry; connector health failure never blocks the rest of Admin

### Provision workflow

1. Staff opens **Provision Resident**
2. Search eligible residents (active allocation)
3. Confirm resident, room/bed, derived username (`resident_code`)
4. Provision → show HotSpot password **once** with copy + warning
5. Password is not persisted in D1, localStorage, or audit logs

### Detail actions

From the account detail modal:

- Enable
- Suspend (confirm)
- Disconnect sessions (confirm)
- Reset password (confirm + one-time show)
- Retry sync
- Live sessions list (best-effort; connector errors shown inline)

### Connector health

- Manual refresh + low-frequency auto refresh (~2 minutes)
- Optional **Ensure Kissmet-Residents profile** staff action
- Never blocks hostel modules or the whole Admin app

### Device limit copy

UI and docs state: **3 simultaneous devices** (`shared-users=3` on `Kissmet-Residents`).

## Secrets / environment

### Worker (`wrangler` secrets / `.dev.vars` — never commit)

| Variable | Purpose |
|---|---|
| `MIKROTIK_CONNECTOR_URL` | Base URL of always-on connector |
| `MIKROTIK_CONNECTOR_SECRET` | Shared Bearer secret |

When missing locally, operations fail with `sync_failed` safely (no crash of hostel modules).

### Connector (`mikrotik-connector/.env` — never commit)

| Variable | Purpose |
|---|---|
| `CONNECTOR_SECRET` | Must match Worker secret |
| `MIKROTIK_HOST` | `192.168.88.1` |
| `MIKROTIK_API_PORT` | `8728` (over private WG) |
| `MIKROTIK_API_USER` | `portal-api` |
| `MIKROTIK_API_PASSWORD` | RouterOS API password |
| `PORT` | HTTP listen port |

Do not place secrets in React/Vite env, Markdown, or git history.

## Deployment requirements

1. Always-on connector host with WireGuard **.5** identity
2. Confirm `192.168.88.1:8728` reachable from `.5` before enabling Worker binding
3. Allowlist connector HTTP; do not expose as a public RouterOS proxy
4. Do not open RouterOS API to the public internet
5. Do not use the RouterOS `admin` account
6. Phase 1 completes Admin operations UI; production connector hosting remains an ops decision

## Packages

| Path | Role |
|---|---|
| `mikrotik-connector/` | Always-on Node/Hono service + unit tests |
| `cloudflare/src/services/internet-access.service.ts` | Domain logic |
| `cloudflare/src/services/mikrotik-connector.client.ts` | Worker → connector HTTP client |
| `cloudflare/src/routes/internet-access.routes.ts` | Admin routes |
| `admin-frontend/src/pages/InternetAccess/` | Phase 1 Admin UI |

## Explicit non-goals (Phase 1)

- Resident dashboard internet card / self-service
- Internet packages or Wi-Fi payments
- Permanent MAC binding
- Production connector hosting selection beyond requirements
- api-ssl / 8729 certificate migration
- Live RouterOS changes from automated CI (NONE — mocks only)
- Changing RouterOS `default` profile
