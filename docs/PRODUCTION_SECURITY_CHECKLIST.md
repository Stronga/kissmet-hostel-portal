# Kissmet Production Security Checklist (Phase 2)

**Branch:** `security-phase2-cloudflare-infrastructure`  
**Status tags:** IMPLEMENTED AND TESTED | CONFIGURATION PREPARED | PRODUCTION DASHBOARD ACTION REQUIRED | PHYSICAL COMMISSIONING REQUIRED | DEFERRED  
**Never mark Pi/MikroTik production-path checks passed unless performed on final hardware/network.**

Target architecture:

```text
Public Internet → Cloudflare (DNS/TLS, WAF/edge, rate limiting, security headers)
  → Workers/Hono API → D1 / private R2 / Arkesel SMS / secure connector path
  → Raspberry Pi → MikroTik hEX S
```

Raspberry Pi is **not** physically commissioned yet.

---

## Can verify in repo now

| # | Control | How | Status |
| --- | --- | --- | --- |
| 1 | Environment separation in `wrangler.toml` (local/test/staging/production) | Inspect TOML; placeholders for prod D1 IDs | CONFIGURATION PREPARED |
| 2 | Production CORS allowlist (admin + portal HTTPS only) | `cors.middleware` + Phase 2 tests | IMPLEMENTED AND TESTED |
| 3 | Dev/localhost origins stripped from production even if mis-set | `sanitizeCorsOriginsForEnv` tests | IMPLEMENTED AND TESTED |
| 4 | No arbitrary Origin reflection / no wildcard+credentials | Tests | IMPLEMENTED AND TESTED |
| 5 | Production auth fail-closed when SMS secrets missing | `productionAuthConfigGuard` + tests | IMPLEMENTED AND TESTED |
| 6 | API security headers (nosniff, frame, CSP API, no-store, CORP/COOP) | Middleware + tests | IMPLEMENTED AND TESTED |
| 7 | HSTS **not** prematurely enabled in Worker | Assert header absent in tests | IMPLEMENTED AND TESTED |
| 8 | Safe public errors (no D1/SQL/R2/Arkesel/MikroTik/secrets) | `safe-error` + tests | IMPLEMENTED AND TESTED |
| 9 | Safe log redaction helper | `safe-log` + tests | IMPLEMENTED AND TESTED |
| 10 | Isolate-local rate limits for staff login, OTP request/verify, admin writes | Code + tests; topology labeled **not distributed** | IMPLEMENTED AND TESTED |
| 11 | D1 OTP controls preserved (request count + attempt_count) | Existing auth tests | IMPLEMENTED AND TESTED |
| 12 | Private document download headers (attachment, nosniff, no-store) | Admin content route + Phase 1/2 tests | IMPLEMENTED AND TESTED |
| 13 | Upload MIME/ext/size validation | Phase 1 tests preserved | IMPLEMENTED AND TESTED |
| 14 | Connector HTTPS requirement in production/staging | Existing connector tests | IMPLEMENTED AND TESTED |
| 15 | Phase 1 security regression suite intact | `security.phase1.test.ts` | IMPLEMENTED AND TESTED |
| 16 | Secrets not committed; `.dev.vars.example` placeholders only | Repo scan / example file | CONFIGURATION PREPARED |

---

## Cloudflare dashboard action

| # | Action | Notes | Status |
| --- | --- | --- | --- |
| 1 | Create production + staging D1 databases; replace placeholder `database_id` | Do not use local IDs | PRODUCTION DASHBOARD ACTION REQUIRED |
| 2 | Create private production + staging R2 buckets (no public access) | Worker binding only | PRODUCTION DASHBOARD ACTION REQUIRED |
| 3 | `wrangler secret put ARKESEL_API_KEY --env production` | Never in TOML/Git | PRODUCTION DASHBOARD ACTION REQUIRED |
| 4 | Set `SMS_PROVIDER=arkesel` + approved `ARKESEL_SENDER_ID` in production vars | After sender approval | PRODUCTION DASHBOARD ACTION REQUIRED |
| 5 | `wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production` | After Pi path exists | PRODUCTION DASHBOARD ACTION REQUIRED |
| 6 | Configure zone SSL/TLS (Full Strict), HTTPS redirects | After DNS | PRODUCTION DASHBOARD ACTION REQUIRED |
| 7 | Enable edge HSTS **only after** HTTPS/domains verified | Do not enable prematurely | PRODUCTION DASHBOARD ACTION REQUIRED |
| 8 | Apply WAF managed rules + bot protections (proportionate) | See audit §WAF | PRODUCTION DASHBOARD ACTION REQUIRED |
| 9 | Configure edge rate limiting (staff login, OTP, admin writes) | See `docs/examples/cloudflare-edge-rate-limits.example.md` | PRODUCTION DASHBOARD ACTION REQUIRED |
| 10 | Deploy portal/admin Pages `_headers` CSP examples | `docs/examples/cloudflare-pages-headers.*.example` | PRODUCTION DASHBOARD ACTION REQUIRED |
| 11 | Worker custom domain / route `api.kissmetgroup.org/*` | Already sketched in TOML | PRODUCTION DASHBOARD ACTION REQUIRED |
| 12 | Cloudflare Tunnel (or approved secure path) hostname for connector | After Pi | PRODUCTION DASHBOARD ACTION REQUIRED |
| 13 | DDoS L3/L4 (included) awareness; optional L7 rules if needed | Small hostel — keep proportionate | PRODUCTION DASHBOARD ACTION REQUIRED |

---

## Requires production resources

| # | Item | Status |
| --- | --- | --- |
| 1 | Real production D1 `database_id` | Requires production resources |
| 2 | Real production R2 bucket | Requires production resources |
| 3 | Arkesel production API key + approved sender | Requires production resources |
| 4 | Staging resources (optional but recommended) | Requires production resources |
| 5 | Cloudflare account zone for `kissmetgroup.org` | Requires production resources |

---

## Requires Raspberry Pi

| # | Item | Status |
| --- | --- | --- |
| 1 | 64-bit Raspberry Pi OS install + updates | PHYSICAL COMMISSIONING REQUIRED |
| 2 | SSH key-only auth; disable password SSH | PHYSICAL COMMISSIONING REQUIRED |
| 3 | Firewall (ufw/nftables): least inbound; SSH limited | PHYSICAL COMMISSIONING REQUIRED |
| 4 | Unprivileged `kissmet` service user | PHYSICAL COMMISSIONING REQUIRED |
| 5 | systemd unit with hardening (`NoNewPrivileges`, `ProtectSystem`, etc.) | PHYSICAL COMMISSIONING REQUIRED (unit template exists in connector package) |
| 6 | Secrets file `/etc/kissmet/mikrotik-connector.env` mode `0600` | PHYSICAL COMMISSIONING REQUIRED |
| 7 | Log rotation + time sync (chrony/NTP) | PHYSICAL COMMISSIONING REQUIRED |
| 8 | Ethernet to management LAN; DHCP reservation / static IP | PHYSICAL COMMISSIONING REQUIRED |
| 9 | UPS / shared backup power with network gear | PHYSICAL COMMISSIONING REQUIRED |
| 10 | Rebuild/reimage runbook validated on hardware | PHYSICAL COMMISSIONING REQUIRED |
| 11 | Cloudflare Tunnel (or equivalent) client on Pi | PHYSICAL COMMISSIONING REQUIRED |

See also `mikrotik-connector/MIKROTIK_CONNECTOR_DEPLOYMENT.md`.

---

## Requires physical MikroTik / network

| # | Item | Status |
| --- | --- | --- |
| 1 | Preserve `portal-api` least privilege | PHYSICAL COMMISSIONING REQUIRED |
| 2 | Preserve `Kissmet-Residents` `shared-users=3`; leave `default` untouched | PHYSICAL COMMISSIONING REQUIRED |
| 3 | Change Allowed Address from WireGuard `.5` (`192.168.216.5/32`) → **Pi LAN IP** (specific host IP, no broad subnet) | PHYSICAL COMMISSIONING REQUIRED |
| 4 | Optionally keep `.5` for intentional **dev** access only | Documented — PHYSICAL COMMISSIONING REQUIRED |
| 5 | No public exposure of RouterOS `8728`/`8729` | PHYSICAL COMMISSIONING REQUIRED (must verify) |
| 6 | API 8728 vs API-SSL 8729 decision (A: private LAN + source restriction, or B: validated API-SSL) | PHYSICAL COMMISSIONING REQUIRED |
| 7 | Do not disable working validated 8728 path until alternative validated | PHYSICAL COMMISSIONING REQUIRED |
| 8 | MikroTik configuration backup (no secrets in git) | PHYSICAL COMMISSIONING REQUIRED |

**Do not modify live MikroTik from this PR.**

---

## Must verify after deployment

| # | Check |
| --- | --- |
| 1 | `https://api.kissmetgroup.org/health` and `/health/db` |
| 2 | CORS: portal/admin allowed; evil origins rejected |
| 3 | Staff login / OTP against production SMS (one controlled test; no blast SMS) |
| 4 | Edge rate-limit rules fire as expected (staging first) |
| 5 | HSTS present **only** after intentional enable |
| 6 | Portal CSP does not break Vite/React production builds |
| 7 | Document download: attachment + nosniff + no public R2 URL |
| 8 | Production errors contain no stack/SQL/Arkesel/MikroTik details |
| 9 | Connector deep health via Tunnel from Worker |
| 10 | D1 backup export + **restore drill** (launch gate) |
| 11 | R2 object access only via authorized Worker |
| 12 | Pi firewall / SSH / secret file permissions |
| 13 | MikroTik Allowed Address = Pi IP only for production `portal-api` |

---

## DNS / domains (do not change live DNS from this PR)

| Domain | Role | Live DNS configured |
| --- | --- | --- |
| `kissmetgroup.org` | Apex / marketing (out of scope) | NO |
| `portal.kissmetgroup.org` | Resident Portal | NO |
| `admin.kissmetgroup.org` | Admin Portal | NO |
| `api.kissmetgroup.org` | Worker API | NO |
| Staging variants | Pre-prod | NO |

---

## Backup / recovery (procedure prepared; restore drill pending)

| Asset | Procedure location | Restore drill |
| --- | --- | --- |
| D1 | `docs/SECURITY_AUDIT_PHASE2.md` §D1 | PENDING — launch gate |
| R2 | same | PENDING |
| App config / wrangler | Git + dashboard | N/A |
| Pi image / connector env | Rebuild checklist | PHYSICAL COMMISSIONING REQUIRED |
| MikroTik backup | Router export (offline store) | PHYSICAL COMMISSIONING REQUIRED |

**No secrets in documentation backups.**
