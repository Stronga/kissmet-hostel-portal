# Kissmet MikroTik Connector

Always-on HTTP bridge between the Cloudflare Worker API and RouterOS HotSpot.

```text
Cloudflare Worker
  → Authorization: Bearer <CONNECTOR_SECRET>
Always-on MikroTik Connector (this service)
  → WireGuard peer .5 (192.168.216.5/32)
MikroTik 192.168.88.1:8728 (RouterOS API)
```

**Cloudflare Workers cannot host WireGuard.** This connector must run on an always-on host that maintains the dedicated `.5` WireGuard tunnel.

## Safety boundary

- Never modifies RouterOS `default` HotSpot profile
- Idempotently ensures dedicated profile `Kissmet-Residents` with `shared-users=3`
- If `Kissmet-Residents` exists with a conflicting `shared-users`, fails safely (no silent overwrite)
- Does not touch firewall, NAT, WireGuard peers, DNS, HotSpot servers, or unrelated users
- Browser never talks to RouterOS or this connector with RouterOS credentials

## Environment

Copy `.env.example` and set secrets outside git:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port (default `8788`) |
| `CONNECTOR_SECRET` | Shared Bearer secret for Worker → connector |
| `MIKROTIK_HOST` | Router LAN address (`192.168.88.1`) |
| `MIKROTIK_API_PORT` | RouterOS API (`8728` over private WG) |
| `MIKROTIK_API_USER` | Dedicated API user (`portal-api`) |
| `MIKROTIK_API_PASSWORD` | RouterOS API password |

Do not commit real values. Do not put these in React/Vite env.

## API (authenticated except `/health`)

All `/v1/*` routes require `Authorization: Bearer <CONNECTOR_SECRET>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Connector + RouterOS reachability |
| POST | `/v1/ensureResidentProfile` | Ensure `Kissmet-Residents` / shared-users=3 |
| GET | `/v1/users/:username` | Read HotSpot user |
| POST | `/v1/users` | Create HotSpot user (`{username,password,comment?}`) |
| POST | `/v1/users/:username/disable` | Disable user |
| POST | `/v1/users/:username/enable` | Enable user |
| POST | `/v1/users/:username/reset-password` | Set new password (`{password}`) |
| DELETE | `/v1/users/:username` | Remove user (optional policy) |
| GET | `/v1/users/:username/sessions` | List active HotSpot sessions |
| POST | `/v1/users/:username/disconnect` | Disconnect active sessions |

## Deployment requirements

1. Always-on Linux (or equivalent) host — not a developer laptop as the sole production path
2. WireGuard client identity **192.168.216.5/32** connected before starting the connector
3. Confirm reachability: `nc -vz 192.168.88.1 8728` from the connector host (source must be `.5`)
4. Allowlist connector HTTP to the Worker egress / private network only — do not expose as a public unauthenticated RouterOS proxy
5. Prefer process supervisor (systemd) + restart on failure
6. Structured logs omit secrets (password/token/authorization redacted)

## Local development

```bash
npm install
cp .env.example .env   # fill secrets locally
npm run typecheck
npm test
npm run dev
```

Unit tests use an in-memory RouterOS mock. Live RouterOS is not required for CI.

## Transport note

Phase 0 uses TCP **8728** over the private WireGuard path. Port **8729** (api-ssl) was observed without a verified certificate; keep config abstract for a later TLS migration.
