# MikroTik Connector — Production Deployment (Phase 3)

**Status gate:** CODE READY — BLOCKED ON PHYSICAL RASPBERRY PI COMMISSIONING. Software packaging, systemd, health, secrets, and docs are ready. The Pi is not yet on site; do **not** claim production Internet Access live until Pi LAN reachability, Cloudflare outbound connectivity, Worker secrets, and RouterOS `portal-api` allowlist for the Pi are verified.

This guide packages the connector for a **single small hostel (<20 rooms)** on a **Raspberry Pi on-site network node**. Prefer **Node.js + systemd**. Do not purchase/provision paid infrastructure from this repo automation. Do not change live RouterOS from this revision.

## Target architecture (production)

```text
Internet / Cloudflare
         │  secure outbound Cloudflare connectivity
         │  (e.g. Cloudflare Tunnel — commissioning deferred)
         ▼
Raspberry Pi — Kissmet On-Site Network Node
├── Kissmet MikroTik Connector (this service — implement / deploy-ready)
├── secure remote-presence / diagnostic capability (architecture / docs only)
└── future basic network monitoring platform (architecture / docs only)
         │  direct private Ethernet / LAN
         ▼
MikroTik hEX S — 192.168.88.1:8728  (RouterOS API as portal-api)
         │
      APs / Wi-Fi
```

| Path | Production meaning |
|---|---|
| Worker → connector | Authenticated HTTPS (or approved Cloudflare Tunnel) — **not** public RouterOS |
| Connector → RouterOS | **Direct hostel LAN** to `192.168.88.1:8728` from the Pi Ethernet/LAN IP |
| WireGuard peer `.5` (`192.168.216.5/32`) | **DEV / remote test only** from the current remote PC — **not** the production path |

Rules:

- Browser never talks to RouterOS, `8728`/`8729`, or connector RouterOS credentials.
- Do **not** expose RouterOS API publicly.
- Do **not** require Starlink port forwarding or a public IPv4 for the connector.
- Cloudflare Workers **cannot** host WireGuard or talk to RouterOS directly; the Pi runs the connector.
- Prefer Ethernet from Pi to the hostel management LAN (static or DHCP-reserved address).
- Recommendation (commissioning, not software): eventually share backup power between the Pi and network equipment.

## Pi three intended responsibilities

| # | Role | Phase 3 scope |
|---|---|---|
| 1 | **Kissmet MikroTik Connector** | Implement + deploy-ready (this package) |
| 2 | **Secure remote-presence / diagnostic node** | Architecture + docs only — do **not** build a large remote-management system |
| 3 | **Basic network monitoring platform** | Architecture + docs only — do **not** build a large monitoring stack |

### Remote-presence (docs only)

Intended outcome: operators can reach the Pi for diagnostics (logs, health, systemd status) through a **secure outbound** Cloudflare pattern (e.g. Tunnel), without opening inbound ports on Starlink or exposing RouterOS.

Out of scope for Phase 3 software: full remote desktop, fleet management, interactive shell product, or inventing unvalidated Cloudflare dashboard config.

### Network monitoring (docs only)

Intended outcome (later): light checks such as LAN reachability to `192.168.88.1`, connector deep health, and uplink presence — enough for a small hostel.

Out of scope for Phase 3 software: Prometheus/Grafana stacks, SNMP meshes, alerting products, or HA monitoring.

## Production host: Raspberry Pi

| Item | Requirement |
|---|---|
| Hardware | Raspberry Pi (64-bit capable); on-site at the hostel |
| OS | **Raspberry Pi OS 64-bit** or other supported **Debian-based 64-bit** Linux |
| Runtime | Node.js **20+**, systemd |
| Network | **Ethernet preferred** to hostel management LAN; static IP or DHCP reservation |
| Reachability | From Pi LAN IP: `192.168.88.1:8728` must be reachable **without** WireGuard `.5` |
| Power | Always-on; prefer shared UPS with MikroTik/APs when commissioned |
| Disk / RAM | <1 GB free disk; 512 MB+ free RAM sufficient for connector |

**STOP:** Physical Pi is **not** available yet. Do not invent a hostname, tunnel ID, or claim commissioning complete. Build so the Pi can be commissioned later **without redesigning the app**.

### Exact host requirements (software)

- Linux aarch64/x86_64 with systemd (Pi OS 64-bit / Debian-based recommended)
- Node.js 20+
- Ability to present the connector privately to Cloudflare (outbound Tunnel or equivalent — see below)
- Secrets only in `/etc/kissmet/mikrotik-connector.env` mode `0600`

WireGuard tools are **not** required on the production Pi. Keep WireGuard on the **developer remote PC** for `.5` lab/live testing.

## Development / remote test path (WireGuard `.5` — retained)

The existing WireGuard peer `.5` config remains useful for development and live testing from the current remote PC. **Do not delete it. Do not treat it as production.**

| Item | Value | Role |
|---|---|---|
| Peer address | `192.168.216.5/32` | DEV / remote test only |
| Endpoint | `hmf0babvp6b.vpn.mynetname.net:58716` | From remote PC |
| Router API | `192.168.88.1:8728` | Reachable via WG from `.5` for lab |
| `portal-api` Allowed Address (live today) | `192.168.216.5/32` | Matches WG peer — see commissioning issue below |

Document clearly:

- **`.5` WireGuard** = development / remote live testing from PC  
- **Pi LAN Ethernet** = production path  

Private WG keys stay out of git (mode `0600` on the machine that holds them). Prefer narrow AllowedIPs on any WG client used for testing (`192.168.88.0/24, 192.168.216.0/24`) — never full-tunnel `0.0.0.0/0` on a long-lived host that also needs normal internet egress.

## Packaging layout

| Path | Purpose |
|---|---|
| `mikrotik-connector/` | Node/Hono service |
| `.env.example` | Placeholders only |
| `deploy/mikrotik-connector.service` | systemd unit template (production = Pi LAN; WG optional for lab) |
| `scripts/install.sh` | First install to `/opt/kissmet/mikrotik-connector` |
| `scripts/upgrade.sh` | Redeploy without wiping secrets env |
| `MIKROTIK_CONNECTOR_DEPLOYMENT.md` | This guide |

## Install (once Pi exists on site)

```bash
# On the Raspberry Pi, from a checked-out repo copy:
sudo ./scripts/install.sh
sudoedit /etc/kissmet/mikrotik-connector.env   # real secrets
# confirm Ethernet / reserved LAN IP; test LAN reachability (below)
sudo systemctl enable --now kissmet-mikrotik-connector
curl -fsS http://127.0.0.1:8788/health
```

Upgrade later:

```bash
sudo ./scripts/upgrade.sh
```

### systemd expectations

- `After=network-online.target` (Ethernet/LAN up before connector)
- Optional `wg-quick@…` After/Wants remain commented/conditional for **lab hosts only** — production Pi does **not** depend on WireGuard
- `Restart=on-failure` with `RestartSec=5`
- `EnvironmentFile=/etc/kissmet/mikrotik-connector.env` (mode `0600`)
- Binds default `127.0.0.1:8788` — Cloudflare Tunnel / local proxy fronts it; not public RouterOS
- `systemctl enable` → automatic boot start; crash recovery via systemd restart

### Pi LAN validation checklist (production path)

| Check | Command / expectation |
|---|---|
| Ethernet up | `ip -4 addr show` shows the Pi management LAN address (not `192.168.216.5`) |
| Reach router | `ping -c2 192.168.88.1` from the Pi |
| TCP API | `nc -vz 192.168.88.1 8728` from the Pi LAN IP |
| portal-api auth | Connector deep health or live validate with `MIKROTIK_API_*` **after** RouterOS allowlist includes the Pi (see commissioning) |
| No public API | Host firewall denies public `8728`/`8729`/`8788` |

## Cloudflare connectivity (Worker ↔ Pi)

Production intent: the Worker reaches the connector through **secure Cloudflare connectivity** (recommended pattern: **Cloudflare Tunnel** outbound from the Pi). The Pi initiates outbound connectivity — **no** Starlink port forwarding, **no** public IPv4 requirement, **no** public RouterOS ports.

| Path | Transport |
|---|---|
| Worker → connector | Authenticated HTTPS via Cloudflare (Tunnel or equivalent) + `Authorization: Bearer <CONNECTOR_SECRET>` |
| Connector → RouterOS | TCP **8728** on **direct hostel LAN** from the Pi |
| api-ssl `8729` | **Deferred** (certificate migration later) |

Rules:

- Only the connector HTTP(S) surface is reachable by the Worker — **not** RouterOS.
- Keep the connector private/authenticated (Bearer secret, timing-safe).
- Do **not** allowlist guessed Cloudflare Worker IPs (they change / are shared).
- **Do not invent Cloudflare Tunnel tokens, tunnel UUIDs, or dashboard steps that have not been validated on site.** Physical Cloudflare + Pi commissioning is **deferred**.

### Worker secrets (Cloudflare) — when commissioning

Set with **wrangler secret** — never put secrets in `wrangler.toml` or frontend env:

```bash
cd cloudflare
npx wrangler secret put MIKROTIK_CONNECTOR_URL --env production
# value: https://<validated-connector-hostname>   # deferred until Tunnel/host exists

npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production
# same value as CONNECTOR_SECRET on the Pi
```

Local/dev: omit or set in `.dev.vars` (gitignored). Missing config → internet ops fail safely (`sync_failed`); hostel modules continue.

### Secret rotation

1. Generate new random secret (≥32 chars).
2. Update Pi env `CONNECTOR_SECRET`; `systemctl restart kissmet-mikrotik-connector`.
3. `wrangler secret put MIKROTIK_CONNECTOR_SECRET` for the Worker env.
4. Verify Admin → Internet Access → connector health.
5. Retire the old secret (no dual-secret window required for a single hostel).

## RouterOS rules (preserve) + commissioning issue

| Item | Rule |
|---|---|
| Application account | `portal-api` only |
| `Kissmet-Residents` | `shared-users=3` |
| `default` profile | `shared-users=250` — **MUST remain unchanged** |
| `admin` account | **Must not** be used by the application |

### COMMISSIONING ISSUE — `portal-api` source allowlist

**Live today:** `portal-api` is restricted to `192.168.216.5/32` (the WireGuard peer used for remote development/testing).

**Production need:** when the Pi receives its final LAN management IP, operators must **safely** adjust or create the appropriate RouterOS API access restriction so `portal-api` accepts the **Pi LAN IP** (and keep `.5` only if still needed for temporary remote testing).

| | |
|---|---|
| Current restriction | `192.168.216.5/32` |
| Required future step | Allow the commissioned Pi LAN management IP for `portal-api` API access |
| This revision | **Do NOT loosen the live restriction. Do NOT change RouterOS remotely.** Document only. |

Until that future step is done on site, production Pi → RouterOS API auth will fail even if TCP `8728` is reachable — that is expected and is an ops commissioning task, not an app redesign.

## Health

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Process liveness (systemd / proxy probes) |
| `GET /v1/health` | Bearer | Deep health: process + RouterOS path (board/version only; no secrets) |

Admin UI continues to fail gracefully when the connector is down.

## Restart / recovery expectations

| Event | Expected behavior |
|---|---|
| Pi reboot | `kissmet-mikrotik-connector` auto-starts via systemd after network-online |
| Connector crash | systemd restarts after ~5s |
| Internet / Cloudflare loss | Worker→connector fails with `unavailable`; no hostel data corruption; LAN RouterOS path unaffected for local diagnostics |
| LAN / MikroTik outage | Deep health 503; Admin shows connector unavailable; D1 unchanged |
| Stale RouterOS sockets | Next call reconnects (stale sockets dropped) |

Bounded timeouts on Worker→connector (~12s) and RouterOS (~10s). No request storms. Password reset is explicit only — **never** auto-retried in a way that creates unknown credentials (Phase 0/1 idempotency preserved).

## Observability

Structured JSON logs on stdout → journald:

```bash
journalctl -u kissmet-mikrotik-connector -f
journalctl -u kissmet-mikrotik-connector --since "1 hour ago"
```

Logged: start/stop, health failures, ROS connect/write failures, operation type success/failure, correlation ID (`x-correlation-id`).

**Never logged:** HotSpot password, portal-api password, `CONNECTOR_SECRET`, WG private keys (dev), `Authorization` header values.

## Alerting / monitoring (future only — not built)

Future targets (document only): process down, deep health failing >N minutes, LAN unreachable to `192.168.88.1`, Cloudflare Tunnel disconnected. Do not deploy a monitoring stack in Phase 3.

## Modes & tests

- Local/mock connector and unit tests do **not** need live router, Pi, or WireGuard.
- Production missing Worker config fails safely.
- Live infra scripts remain opt-in (`scripts/live-phase1-validate.mts`) and separate from CI.
- Remote PC + WG `.5` remains the supported path for optional live RouterOS validation until the Pi is commissioned.

## Post-cutover E2E (operator — after Pi exists)

1. Process `/health` OK on Pi
2. Authenticated `/v1/health` OK (RouterOS reachable **from Pi LAN**, after allowlist update)
3. Cloudflare outbound connectivity validated; Worker secrets set; Admin connector-health OK
4. Optional temporary HotSpot user create/read/disable/enable/reset/session/disconnect/remove + cleanup
5. Confirm `Kissmet-Residents` shared-users=3; `default` unchanged; real users untouched

## Deferred

- Physical Raspberry Pi install and Ethernet addressing
- Validated Cloudflare Tunnel (or equivalent) configuration
- RouterOS `portal-api` allowlist update for Pi LAN IP
- RouterOS api-ssl `8729` certificate migration
- Alerting / HA / large remote-management or monitoring products
- Automatic entitlement reconciliation
- Resident self-service features
