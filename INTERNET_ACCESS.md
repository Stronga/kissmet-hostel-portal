# Kissmet Internet Access — Phase 0

Isolated **Internet Access** module for staff/admin provisioning of resident HotSpot identities. MikroTik enforces network entitlement; Kissmet D1 remains the source of truth for residents.

## Product boundary (LOCKED)

Core hostel flow is unchanged and must never be altered by this module:

```text
Resident → Documents → Application → Booking → Payment → Allocation / Room
```

Rules:

- Internet access is only for Kissmet residents with an **active room/bed allocation**
- Staff/admin initiates provisioning only — no resident self-service in Phase 0
- No internet packages; do not reuse `room_rates`, hostel payments, or accommodation statuses
- Internet failure must never corrupt registration, OTP, applications, bookings, payments, receipts, allocations, maintenance, or RBAC
- Residents do not administer MikroTik

## Architecture

```text
Kissmet Admin UI
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

## Sync states

| State | Meaning |
|---|---|
| `pending` | Operation accepted; awaiting / in-flight connector sync |
| `synced` | D1 desired state matches last successful RouterOS operation |
| `failed` | Connector/RouterOS unavailable or rejected; hostel data untouched |

Connector outage → internet op becomes pending/failed; hostel workflows continue.

## RBAC

Permissions (code map in `cloudflare/src/auth/permissions.ts`):

- `internet:read` — list/get/sessions
- `internet:manage` — provision/enable/suspend/reset/disconnect/retry-sync

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

Password values are never audited.

## Admin API

Under `/admin` (auth + permission required):

| Method | Path |
|---|---|
| GET | `/admin/internet-access` |
| GET | `/admin/internet-access/:id` |
| GET | `/admin/internet-access/:id/sessions` |
| POST | `/admin/internet-access/residents/:residentId/provision` |
| POST | `/admin/internet-access/:id/enable` |
| POST | `/admin/internet-access/:id/suspend` |
| POST | `/admin/internet-access/:id/reset-password` |
| POST | `/admin/internet-access/:id/disconnect` |
| POST | `/admin/internet-access/:id/retry-sync` |

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
6. Phase 0: no production deploy of this module until Phase 1 review

## Packages

| Path | Role |
|---|---|
| `mikrotik-connector/` | Always-on Node/Hono service + unit tests |
| `cloudflare/src/services/internet-access.service.ts` | Domain logic |
| `cloudflare/src/services/mikrotik-connector.client.ts` | Worker → connector HTTP client |
| `cloudflare/src/routes/internet-access.routes.ts` | Admin routes |

## Explicit non-goals (Phase 0)

- Resident dashboard internet card / self-service
- Internet packages or Wi-Fi payments
- Permanent MAC binding
- Production connector hosting selection beyond requirements
- api-ssl / 8729 certificate migration
- Live RouterOS changes from this implementation (NONE)
