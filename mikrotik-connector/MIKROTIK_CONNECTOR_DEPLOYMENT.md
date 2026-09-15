# MikroTik Connector — Production Deployment (Phase 3)

**Status gate:** CODE READY — BLOCKED ON PRODUCTION CONNECTOR HOST until an always-on host is selected, WireGuard `.5` is moved there, HTTPS is terminated, and Worker secrets are set.

This guide packages the connector for a **single small hostel (<20 rooms)**. Prefer **Node.js + systemd**. Do not purchase/provision paid infrastructure from this repo automation.

## Target architecture

```text
Resident/Admin browser
  → Cloudflare Kissmet API (Worker)
  → HTTPS + Authorization: Bearer <CONNECTOR_SECRET>
Always-on MikroTik Connector (this host)
  → WireGuard peer .5 (192.168.216.5/32)
MikroTik hEX S 192.168.88.1:8728 (RouterOS API as portal-api)
```

- Browser never talks to RouterOS, `8728`/`8729`, or connector RouterOS credentials.
- Do **not** expose RouterOS API publicly.
- Cloudflare Workers **cannot** host WireGuard.

## Host recommendation (tradeoff — do not silently select)

| Option | Pros | Cons | Fit |
|---|---|---|---|
| **Small VPS** (1 vCPU / 1 GB) | Always-on, public HTTPS easy (Caddy/nginx + Let’s Encrypt), simple remote ops, cheap | Needs WireGuard outbound to `hmf0babvp6b.vpn.mynetname.net:58716`; another monthly bill | **Usually best** for reliability when staff laptops sleep |
| **Hostel-local mini-PC / NUC** | Low recurring cost after purchase; LAN-adjacent | Must stay powered; home/ISP outages; HTTPS needs tunnel (Cloudflare Tunnel / Tailscale Funnel) or port-forward + certs; physical access risk | Good if electricity/uptime reliable and ops are on-site |
| Developer Windows PC + desktop WG | Fine for Phase 0/1 lab only | Sleeps, reboots, not production | **Not production** |

Preference for Kissmet scale: **one small Linux VPS or one dedicated mini-PC**, systemd-supervised, no Kubernetes/mesh/HA. A second connector host can be added later; do not build HA now.

### Exact host requirements

- Linux (Ubuntu 22.04/24.04 LTS or Debian 12 recommended)
- Node.js **20+**
- systemd
- WireGuard tools (`wireguard-tools`)
- Outbound UDP to MikroTik WG endpoint `hmf0babvp6b.vpn.mynetname.net:58716`
- Ability to present **HTTPS** to Cloudflare Workers (reverse proxy with trusted cert, or approved HTTPS tunnel)
- Always-on power / network
- Disk: <1 GB free sufficient; RAM: 512 MB+ free

**STOP:** Do not invent a hostname or deploy until the operator selects/provisions the host.

## Packaging layout

| Path | Purpose |
|---|---|
| `mikrotik-connector/` | Node/Hono service |
| `.env.example` | Placeholders only |
| `deploy/mikrotik-connector.service` | systemd unit template |
| `scripts/install.sh` | First install to `/opt/kissmet/mikrotik-connector` |
| `scripts/upgrade.sh` | Redeploy without wiping secrets env |
| `MIKROTIK_CONNECTOR_DEPLOYMENT.md` | This guide |

## Install (once host exists)

```bash
# On the connector host, from a checked-out repo copy:
sudo ./scripts/install.sh
sudoedit /etc/kissmet/mikrotik-connector.env   # real secrets
# configure WireGuard .5 (below)
sudo systemctl enable --now kissmet-mikrotik-connector
curl -fsS http://127.0.0.1:8788/health
```

Upgrade later:

```bash
sudo ./scripts/upgrade.sh
```

### systemd expectations

- `After=network-online.target` and `wg-quick@wg0` (rename interface in unit if needed)
- `Restart=on-failure` with `RestartSec=5`
- `EnvironmentFile=/etc/kissmet/mikrotik-connector.env` (mode `0600`)
- Binds default `127.0.0.1:8788` — TLS terminates at reverse proxy / tunnel

## WireGuard production setup (connector host)

### Locked live facts

| Item | Value |
|---|---|
| Router | hEX S RouterOS 7.24.2 |
| API | `192.168.88.1:8728` (OK **only** inside WireGuard) |
| portal-api Allowed Address | `192.168.216.5/32` |
| Peer `.5` address | `192.168.216.5/32` |
| Endpoint | `hmf0babvp6b.vpn.mynetname.net:58716` |
| Prior desktop AllowedIPs | full-tunnel `0.0.0.0/0,::/0` — **do not blindly carry into production** |

### Private key handling

- WireGuard **private key NEVER committed** to git, Markdown, tickets, or screenshots.
- Store only in `/etc/wireguard/*.conf` with mode `0600`, owned by root.
- Rotate by generating a new keypair offline; update MikroTik peer public key during a maintenance window.

### AllowedIPs / route decision (narrow preferred)

Full-tunnel `0.0.0.0/0` on a production connector hijacks all host egress (breaks apt, DNS, HTTPS renewals, and Cloudflare reachability). Prefer the **narrowest** routes needed for RouterOS API:

**Recommended production AllowedIPs (document-only; do not remotely change MikroTik unless explicitly approved):**

```text
AllowedIPs = 192.168.88.0/24, 192.168.216.0/24
```

Rationale:

- `192.168.88.0/24` — RouterOS LAN / API (`192.168.88.1`)
- `192.168.216.0/24` — WG tunnel net (peer addressing)

If management later needs other private nets, add them explicitly. Do **not** use `0.0.0.0/0` on the connector host.

> Live MikroTik peer config is **document-only for Phase 3** unless an operator explicitly changes it safely during cutover. Moving `.5` from the developer PC to the production host requires the same private key (or a coordinated peer key swap) so only one client uses `.5` at a time (`portal-api` allowlist is `/32`).

### Example wg-quick config (placeholders)

```ini
[Interface]
Address = 192.168.216.5/32
PrivateKey = <NEVER_COMMIT>
# Optional: Table = off  + explicit ip route if policy routing required

[Peer]
PublicKey = <MIKROTIK_WG_PUBLIC_KEY>
Endpoint = hmf0babvp6b.vpn.mynetname.net:58716
AllowedIPs = 192.168.88.0/24, 192.168.216.0/24
PersistentKeepalive = 25
```

Enable:

```bash
sudo systemctl enable --now wg-quick@wg0
```

### Validation checklist (must pass on connector host)

| Check | Command / expectation |
|---|---|
| Source address `.5` | `ip -4 addr show` shows `192.168.216.5` on WG iface |
| Reach `192.168.88.1` | `ping -c2 192.168.88.1` |
| TCP `8728` | `nc -vz 192.168.88.1 8728` |
| portal-api auth | Connector deep health or live validate script with `MIKROTIK_API_*` |
| Only one `.5` client | Developer desktop WG disconnected during production cutover |

## HTTPS / exposure

| Path | Transport |
|---|---|
| Worker → connector | **HTTPS** with trusted certificates (or approved Cloudflare Tunnel / similar) |
| Connector → RouterOS | TCP **8728** inside WireGuard only |
| api-ssl `8729` | **Deferred** (certificate migration later) |

Rules:

- Only connector HTTPS is reachable by the Worker — **not** RouterOS.
- Host firewall: allow `443` (or tunnel) inbound; deny public `8728`/`8729`/`8788`.
- Reverse proxy terminates TLS and forwards to `127.0.0.1:8788`.
- **Do not** allowlist guessed Cloudflare Worker IPs (they change / are shared). Auth is the Bearer secret over HTTPS.
- Connector auth: `Authorization: Bearer <CONNECTOR_SECRET>` (timing-safe). No secret in query/browser/git/logs.

### Example Caddy site (illustrative)

```caddy
connector.example.com {
  reverse_proxy 127.0.0.1:8788
}
```

## Worker secrets (Cloudflare)

Set with **wrangler secret** — never put secrets in `wrangler.toml` or frontend env:

```bash
cd cloudflare
npx wrangler secret put MIKROTIK_CONNECTOR_URL --env production
# value: https://connector.example.com

npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production
# same value as CONNECTOR_SECRET on the host
```

Local/dev: omit or set in `.dev.vars` (gitignored). Missing config → internet ops fail safely (`sync_failed`); hostel modules continue.

### Secret rotation

1. Generate new random secret (≥32 chars).
2. Update connector host env `CONNECTOR_SECRET`; `systemctl restart kissmet-mikrotik-connector`.
3. `wrangler secret put MIKROTIK_CONNECTOR_SECRET` for the Worker env.
4. Verify Admin → Internet Access → connector health.
5. Retire the old secret (no dual-secret window required for a single hostel).

## Health

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Process liveness (systemd / proxy probes) |
| `GET /v1/health` | Bearer | Deep health: process + RouterOS path (board/version only; no secrets) |

Admin UI continues to fail gracefully when the connector is down.

## Restart / recovery expectations

| Event | Expected behavior |
|---|---|
| Host reboot | `wg-quick` + `kissmet-mikrotik-connector` auto-start via systemd |
| Connector crash | systemd restarts after ~5s |
| Internet loss | Requests fail with `unavailable`; no hostel data corruption |
| WG reconnect | Next RouterOS call reconnects (stale sockets dropped) |
| MikroTik outage | Deep health 503; Admin shows connector unavailable; D1 unchanged |

Bounded timeouts on Worker→connector (~12s) and RouterOS (~10s). No request storms. Password reset is explicit only — **never** auto-retried in a way that creates unknown credentials (Phase 0/1 idempotency preserved).

## Observability

Structured JSON logs on stdout → journald:

```bash
journalctl -u kissmet-mikrotik-connector -f
journalctl -u kissmet-mikrotik-connector --since "1 hour ago"
```

Logged: start/stop, health failures, ROS connect/write failures, operation type success/failure, correlation ID (`x-correlation-id`).

**Never logged:** HotSpot password, portal-api password, `CONNECTOR_SECRET`, WG private key, `Authorization` header values.

## Alerting (future only — not built)

Future targets (document only): process down, deep health failing >N minutes, TLS cert expiry, WG handshake stale. Do not deploy a monitoring stack in Phase 3.

## Modes & tests

- Local/mock connector and unit tests do **not** need live router or WireGuard.
- Production missing Worker config fails safely.
- Live infra scripts remain opt-in (`scripts/live-phase1-validate.mts`) and separate from CI.

## Post-cutover E2E (operator — after host exists)

1. Process `/health` OK
2. Authenticated `/v1/health` OK (RouterOS reachable)
3. Worker secrets set; Admin connector-health OK
4. Optional temporary HotSpot user create/read/disable/enable/reset/session/disconnect/remove + cleanup
5. Confirm `Kissmet-Residents` shared-users=3; `default` unchanged; real users untouched

## Deferred

- RouterOS api-ssl `8729` certificate migration
- Alerting / HA
- Automatic entitlement reconciliation
- Resident self-service features
