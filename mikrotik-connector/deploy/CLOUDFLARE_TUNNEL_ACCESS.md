# Cloudflare Tunnel + Access + Worker secrets for the MikroTik connector (PREPARED, NOT APPLIED)

Status: templates and plan only. Nothing here has been created on the Cloudflare account,
the Pi, or the router. Every step marked **[APPROVAL]** needs the owner's go-ahead.

## Topology

```
Admin/Resident browser ──HTTPS──▶ Worker api.kissmetgroup.org
                                    │  fetch https://<CONNECTOR_HOSTNAME>/v1/...
                                    │  headers: Authorization: Bearer <MIKROTIK_CONNECTOR_SECRET>
                                    │           CF-Access-Client-Id / CF-Access-Client-Secret
                                    ▼
                         Cloudflare Access (service-token-only policy)
                                    ▼
                         Cloudflare Tunnel (outbound from Pi)
                                    ▼
             Pi: cloudflared ──▶ http://127.0.0.1:8788 (connector, BIND_HOST=127.0.0.1, TRUST_PROXY=true)
                                    ▼  api-ssl 8729 (TLS, CA-verified)
                              MikroTik 192.168.88.1

Pi heartbeat (Python, kissmet-svc) ──HTTPS + HMAC──▶ Worker POST /connector/heartbeat ──▶ D1 connector_heartbeats (0020)
```

Defence in depth on the connector hostname: (1) Access service token at the edge, (2) Bearer
secret in the connector (constant-time), (3) connector rate limits keyed by `CF-Connecting-IP`
(TRUST_PROXY=true is only valid here because the connector listens on loopback).

## 1. Tunnel (on the Pi) **[APPROVAL]**

1. Install cloudflared from Cloudflare's apt repo (arm64). It runs as its own `cloudflared` user.
2. `cloudflared tunnel login` (owner completes browser auth) → `cloudflared tunnel create kissmet-connector`.
3. Copy `deploy/cloudflared/config.yml.example` → `/etc/cloudflared/config.yml`, fill
   `<TUNNEL_UUID>` and `<CONNECTOR_HOSTNAME>`; `chmod 0640`, owner `root:cloudflared`.
4. `cloudflared tunnel ingress validate`.
5. **Create the Access application (§2) first**, then `cloudflared tunnel route dns kissmet-connector <CONNECTOR_HOSTNAME>`.
6. `cloudflared service install` → `systemctl enable --now cloudflared`.

Alternative: a dashboard-managed (token) tunnel with the same single ingress rule; then the
token goes in the cloudflared unit, never in git.

## 2. Access application (dashboard) **[APPROVAL]**

- Zero Trust → Access → Applications → *Self-hosted*: domain `<CONNECTOR_HOSTNAME>` (all paths).
- Service Auth → Service Tokens → create `kissmet-worker-connector` (duration: 1 year; calendar a rotation).
  Record Client ID / Client Secret straight into `wrangler secret put` (§3). The secret is shown once.
- Policy: **Action = Service Auth**, Include = *Service Token* `kissmet-worker-connector`. No identity
  providers, no "Everyone", no bypass rules.
- Session duration: shortest available (service tokens are re-sent on every request anyway).
- Verify (from any machine, no token) `curl -sI https://<CONNECTOR_HOSTNAME>/health` → 302/403 from Access,
  never the connector's JSON.

The Worker client sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` when both Worker secrets
are set, uses `redirect: "manual"`, and maps an Access 302/403 to "connector unavailable"
(`cloudflare/src/services/mikrotik-connector.client.ts`). `validateProductionConfig` reports a
half-configured token as **high** and a missing token (with a connector URL) as **medium**.

## 3. Worker secrets / vars (names only — run nothing until approved) **[APPROVAL]**

| Name | Kind | Purpose |
|---|---|---|
| `MIKROTIK_CONNECTOR_URL` | var or secret | `https://<CONNECTOR_HOSTNAME>` (HTTPS enforced in production/staging) |
| `MIKROTIK_CONNECTOR_SECRET` | secret | Bearer secret = Pi `CONNECTOR_SECRET` (>=32 chars) |
| `MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID` | secret | Access service token Client ID |
| `MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET` | secret | Access service token Client Secret |
| `CONNECTOR_HEARTBEAT_SECRET` | secret | HMAC key for Pi → Worker heartbeat (>=32 chars, different from the Bearer secret) |
| `CONNECTOR_HEARTBEAT_SECRET_PREVIOUS` | secret (optional) | only during rotation overlap |
| `CONNECTOR_HEARTBEAT_ALLOWED_IDS` | var | the Pi's connector UUID (lowercase), comma-separated |
| `CONNECTOR_HEARTBEAT_STALE_SECONDS` | var (optional) | default 180 |
| `ARKESEL_API_KEY` | secret | already required by production (`SMS_PROVIDER=arkesel` is set in wrangler.toml) |

Commands (do not run without approval; values are typed at the prompt, never on the command line):

```
npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production
npx wrangler secret put MIKROTIK_CONNECTOR_ACCESS_CLIENT_ID --env production
npx wrangler secret put MIKROTIK_CONNECTOR_ACCESS_CLIENT_SECRET --env production
npx wrangler secret put MIKROTIK_CONNECTOR_URL --env production
npx wrangler secret put CONNECTOR_HEARTBEAT_SECRET --env production
# CONNECTOR_HEARTBEAT_ALLOWED_IDS: add under [env.production.vars] after the Pi UUID is known
```

Do staging first (`--env staging`) if a staging Worker/D1 exists.

## 4. Connector env on the Pi

`deploy/connector.env.production.example` → `/etc/kissmet/mikrotik-connector.env` (install.sh does
this, root:root 0600). It is the **only** place `TRUST_PROXY=true` is set; `BIND_HOST=127.0.0.1`
stays everywhere, and the connector refuses to start with `TRUST_PROXY=true` on a non-loopback bind
or with a non-loopback bind in production. The dev `.env.example` keeps `TRUST_PROXY=false`.

## 5. Rotation

- Bearer: set new value on Pi + Worker in the same maintenance window (no dual-secret support yet;
  expect a few seconds of 401 → admin retry-sync).
- Access token: create a second token, add it to the policy, update Worker secrets, then revoke the old one.
- Heartbeat: put the new key in `CONNECTOR_HEARTBEAT_SECRET` and the old one in
  `CONNECTOR_HEARTBEAT_SECRET_PREVIOUS`, update the Pi, then delete `_PREVIOUS`.
