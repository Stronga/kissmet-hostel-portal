# Kissmet MikroTik Connector

Always-on HTTP bridge between the Cloudflare Worker API and RouterOS HotSpot.

```text
Cloudflare Worker
  → HTTPS + Authorization: Bearer <CONNECTOR_SECRET>
Always-on MikroTik Connector (this service)
  → WireGuard peer .5 (192.168.216.5/32)
MikroTik 192.168.88.1:8728 (RouterOS API)
```

**Cloudflare Workers cannot host WireGuard.** This connector must run on an always-on host that maintains the dedicated `.5` WireGuard tunnel.

**Phase 3:** packaging + hardening ready. Production cutover is **blocked on selecting/provisioning an always-on connector host** (see `MIKROTIK_CONNECTOR_DEPLOYMENT.md`).

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
| `CONNECTOR_MODE` | `local` or `production` |
| `BIND_HOST` | Listen address (default `127.0.0.1`) |
| `PORT` | HTTP listen port (default `8788`) |
| `CONNECTOR_SECRET` | Shared Bearer secret for Worker → connector |
| `MIKROTIK_HOST` | Router LAN address (`192.168.88.1`) |
| `MIKROTIK_API_PORT` | RouterOS API (`8728` over private WG) |
| `MIKROTIK_API_USER` | Dedicated API user (`portal-api`) |
| `MIKROTIK_API_PASSWORD` | RouterOS API password |

Do not commit real values. Do not put these in React/Vite env.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Process liveness |
| GET | `/v1/health` | Bearer | Deep health (RouterOS path; redacted) |
| POST | `/v1/ensureResidentProfile` | Bearer | Ensure `Kissmet-Residents` / shared-users=3 |
| GET | `/v1/users/:username` | Bearer | Read HotSpot user |
| POST | `/v1/users` | Bearer | Create HotSpot user |
| POST | `/v1/users/:username/disable` | Bearer | Disable user |
| POST | `/v1/users/:username/enable` | Bearer | Enable user |
| POST | `/v1/users/:username/reset-password` | Bearer | Set new password |
| DELETE | `/v1/users/:username` | Bearer | Remove user |
| GET | `/v1/users/:username/sessions` | Bearer | List active sessions |
| POST | `/v1/users/:username/disconnect` | Bearer | Disconnect sessions |

## Production packaging (Linux + systemd)

```bash
sudo ./scripts/install.sh          # first install
sudoedit /etc/kissmet/mikrotik-connector.env
# WireGuard .5 + HTTPS reverse proxy — see MIKROTIK_CONNECTOR_DEPLOYMENT.md
sudo systemctl enable --now kissmet-mikrotik-connector
sudo ./scripts/upgrade.sh          # later redeploys
journalctl -u kissmet-mikrotik-connector -f
```

## Local development

```bash
npm install
cp .env.example .env   # fill secrets locally
export $(grep -v '^#' .env | xargs)   # or use your preferred env loader
npm run typecheck
npm test
npm run dev
```

Unit tests use an in-memory RouterOS mock. Live RouterOS / WireGuard is not required for CI.

## Transport note

Phase 0–3 use TCP **8728** over the private WireGuard path. Port **8729** (api-ssl) deferred until certificate migration.
