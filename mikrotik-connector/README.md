# Kissmet MikroTik Connector

Always-on HTTP bridge between the Cloudflare Worker API and RouterOS HotSpot, intended to run on the **on-site Raspberry Pi**.

```text
Internet / Cloudflare
         │  secure outbound Cloudflare connectivity
         ▼
Raspberry Pi — Kissmet Connector (this service)
         │  direct private Ethernet / LAN
         ▼
MikroTik hEX S 192.168.88.1:8728 (RouterOS API as portal-api)
```

**Production path:** Pi LAN → `192.168.88.1:8728` (not WireGuard).  
**Dev / remote test path:** WireGuard peer `.5` (`192.168.216.5/32`) from the remote PC — retained; do not delete; do not treat as production.

**Phase 3:** packaging + hardening ready for Pi OS 64-bit / Debian-based Linux + systemd. Physical Pi and Cloudflare Tunnel commissioning are **deferred** (see `MIKROTIK_CONNECTOR_DEPLOYMENT.md`).

## Safety boundary

- Never modifies RouterOS `default` HotSpot profile
- Idempotently ensures dedicated profile `Kissmet-Residents` with `shared-users=3`
- If `Kissmet-Residents` exists with a conflicting `shared-users`, fails safely (no silent overwrite)
- Does not touch firewall, NAT, WireGuard peers, DNS, HotSpot servers, or unrelated users
- Browser never talks to RouterOS or this connector with RouterOS credentials
- Application uses `portal-api` only — never RouterOS `admin`

## Environment

Copy `.env.example` and set secrets outside git:

| Variable | Purpose |
|---|---|
| `CONNECTOR_MODE` | `local` or `production` |
| `ROUTEROS_DRIVER` | `real` (default when unset) or `mock` (in-memory, dev/test only; refused in production) |
| `BIND_HOST` | Listen address (default `127.0.0.1`) |
| `PORT` | HTTP listen port (default `8788`) |
| `CONNECTOR_SECRET` | Shared Bearer secret for Worker → connector |
| `MIKROTIK_HOST` | Router LAN address (`192.168.88.1`) — same host; path is Pi LAN in production, WG `.5` in remote lab |
| `MIKROTIK_API_PORT` | RouterOS API (`8728` over private path only) |
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

## Production packaging (Raspberry Pi + systemd)

```bash
sudo ./scripts/install.sh          # first install on Pi
sudoedit /etc/kissmet/mikrotik-connector.env
# Ethernet to hostel LAN + Cloudflare outbound — see MIKROTIK_CONNECTOR_DEPLOYMENT.md
sudo systemctl enable --now kissmet-mikrotik-connector
sudo ./scripts/upgrade.sh          # later redeploys
journalctl -u kissmet-mikrotik-connector -f
```

## Local development

```bash
npm ci
npm run typecheck
npm test
```

Unit tests use an in-memory RouterOS mock (`src/routeros/mock-client.ts`). Live RouterOS / Pi / WireGuard is not required for CI.

### Safe local run: mock RouterOS driver (recommended)

`ROUTEROS_DRIVER=mock` runs the full HTTP API against an in-memory fake router
(seeded with only the RouterOS `default` HotSpot profile). It never imports or
constructs the real `node-routeros` client and opens no connection to any
MikroTik, so `MIKROTIK_HOST` / `MIKROTIK_API_PASSWORD` are not needed. State is
lost on restart. Startup logs a `routeros_mock_driver_active` warning and
`/v1/health` reports `board: "mock"`, `routerosDriver: "mock"`.

Rules:

- **Production refuses mock.** With `CONNECTOR_MODE=production` (or `prod`, or
  `NODE_ENV=production`) and `ROUTEROS_DRIVER=mock`, the process exits at startup.
  Any value other than `real` / `mock` is also a startup error.
- **Turn WireGuard off** (or at least use mock) on a dev PC that has the `.5`
  peer: the router accepts `portal-api` from that address, so `npm run dev` with
  the `real` driver and real credentials talks to the **live** hostel router.
- **Never run `scripts/live-phase1-validate.mts`** during development — it creates
  and deletes a user on the live router. Do not run `install.sh` / `upgrade.sh`
  on a dev machine.
- Use throwaway local secrets only; never real router or Worker secrets.

Bash / Linux / macOS / Git Bash:

```bash
export CONNECTOR_MODE=local
export ROUTEROS_DRIVER=mock
export CONNECTOR_SECRET='local-dev-only-secret-change-me-0123456789'
npm run dev

# another terminal
curl -s http://127.0.0.1:8788/health
curl -s -H "Authorization: Bearer $CONNECTOR_SECRET" http://127.0.0.1:8788/v1/health
curl -s -X POST -H "Authorization: Bearer $CONNECTOR_SECRET" -H "Content-Type: application/json" \
  -d '{"username":"KSM-RES-0001","password":"dev-only-pass"}' http://127.0.0.1:8788/v1/users
```

Windows PowerShell:

```powershell
$env:CONNECTOR_MODE = "local"
$env:ROUTEROS_DRIVER = "mock"
$env:CONNECTOR_SECRET = "local-dev-only-secret-change-me-0123456789"
npm run dev

# another PowerShell window (set the same $env:CONNECTOR_SECRET there first)
$h = @{ Authorization = "Bearer $env:CONNECTOR_SECRET" }
Invoke-RestMethod http://127.0.0.1:8788/health
Invoke-RestMethod http://127.0.0.1:8788/v1/health -Headers $h
Invoke-RestMethod http://127.0.0.1:8788/v1/users -Method Post -Headers $h `
  -ContentType "application/json" -Body '{"username":"KSM-RES-0001","password":"dev-only-pass"}'
```

Unset the variables (`unset ROUTEROS_DRIVER` / `Remove-Item Env:ROUTEROS_DRIVER`)
before any deliberate real-router work; with nothing set the driver is `real`.

### Real driver (lab only)

```bash
cp .env.example .env   # fill secrets locally (gitignored); ROUTEROS_DRIVER=real
export $(grep -v '^#' .env | xargs)   # or use your preferred env loader
npm run dev
```

This contacts `MIKROTIK_HOST` on the first RouterOS call. Only do this
deliberately from the remote-lab path (WG `.5`) or the Pi LAN.

## Transport note

Phase 0–3 use TCP **8728** on a private path only (production = Pi LAN; lab = WG `.5`). Port **8729** (api-ssl) deferred until certificate migration.
