# Kissmet Production Security — Phase 2 (Cloudflare & Infrastructure Hardening Preparation)

**Branch:** `security-phase2-cloudflare-infrastructure`  
**Base:** `main` @ `bcef249` (Security Phase 1 merged)  
**Scope:** Cloudflare / Worker / D1 / R2 / edge preparation + Pi / MikroTik / connector **documentation and checklists**.  
**Deploy / merge / live DNS / live MikroTik / live SMS:** Not performed.

Preserved from Phase 1 (do not weaken):

- `docs/SECURITY_AUDIT_PHASE1.md`
- `cloudflare/src/security.phase1.test.ts`

## Status vocabulary

| Tag | Meaning |
| --- | --- |
| IMPLEMENTED AND TESTED | Code in repo with automated tests |
| CONFIGURATION PREPARED | Config/docs ready; not active in production |
| PRODUCTION DASHBOARD ACTION REQUIRED | Needs Cloudflare (or vendor) dashboard change |
| PHYSICAL COMMISSIONING REQUIRED | Needs real Pi / MikroTik / LAN |
| DEFERRED | Intentionally postponed |

Never claim a production control is **active** from documentation alone. Never mark Pi/MikroTik production-path checks as passed unless executed on final hardware/network.

---

## Findings summary

| Severity | Count | Notes |
| --- | --- | --- |
| Critical | 0 confirmed exploitable in repo | Production SMS misconfig would fail-closed (now guarded on auth routes) |
| High | 0 unfixed in-repo | Edge rate limit / WAF / HSTS remain dashboard commissioning |
| Medium | several documented | Isolate-local rate limits are not edge-global; portal CSP not yet on Pages |
| Low | several | Upload malware scanning deferred; wrangler toolchain audit deferred |
| Informational | several | Architecture / proportionate DDoS posture for small hostel |

### Confirmed / addressed in this phase

| ID | Severity | Finding | Remediation | Status |
| --- | --- | --- | --- | --- |
| SEC-P2-001 | MEDIUM | Production could be misconfigured with localhost CORS if `ADMIN_ALLOWED_ORIGINS` wrongly set | Sanitize/strip insecure origins for staging/production | IMPLEMENTED AND TESTED |
| SEC-P2-002 | HIGH (config) | Missing production SMS secrets could leave auth surfaces confusing | Fail-closed `productionAuthConfigGuard` on login/OTP routes | IMPLEMENTED AND TESTED |
| SEC-P2-003 | MEDIUM | Rate limiting still isolate-local | Document topology; composite IP+identity keys; D1 OTP preserved; edge rules documented | IMPLEMENTED AND TESTED + PRODUCTION DASHBOARD ACTION REQUIRED |
| SEC-P2-004 | MEDIUM | API headers lacked object-src / CORP / Pragma | Extended `securityHeadersMiddleware` | IMPLEMENTED AND TESTED |
| SEC-P2-005 | LOW | Error redaction gaps for Arkesel/MikroTik/bindings | Expanded `looksUnsafe` | IMPLEMENTED AND TESTED |
| SEC-P2-006 | INFO | No portal document CSP in repo | Example `_headers` for Pages | CONFIGURATION PREPARED |
| SEC-P2-007 | INFO | HSTS must not be premature | Explicitly **not** set in Worker; activation documented | CONFIGURATION PREPARED |
| SEC-P2-008 | INFO | WAF/bots not expressible as tested Worker code | Document plan | PRODUCTION DASHBOARD ACTION REQUIRED |
| SEC-P2-009 | INFO | Pi / MikroTik / Tunnel not commissioned | Full checklists | PHYSICAL COMMISSIONING REQUIRED |

---

## 1. Cloudflare environment separation

**CONFIGURATION PREPARED** — `cloudflare/wrangler.toml`

| Env | Worker name | D1 | R2 | SMS default | Notes |
| --- | --- | --- | --- | --- | --- |
| local | `kissmet-hostel-api-local` | local | local | mock | Dev |
| test | `kissmet-hostel-api-test` | test placeholders | test | mock | CI isolation |
| staging | `kissmet-hostel-api-staging` | placeholder ID | staging bucket name | mock unless explicitly arkesel | |
| production | `kissmet-hostel-api-production` | placeholder ID | production bucket | must be arkesel via secrets | `workers_dev=false` |

Placeholders: `replace-with-*-d1-database-id`. **Do not** point production at local/test D1/R2, mock SMS, localhost origins, or WireGuard `.5` connector.

---

## 2. Secrets management

**CONFIGURATION PREPARED** + **IMPLEMENTED AND TESTED** (fail-closed guards)

| Secret | Storage | Git/TOML | Fail-closed |
| --- | --- | --- | --- |
| `ARKESEL_API_KEY` | Worker secret | Never | Auth OTP routes 503 if production missing |
| `ARKESEL_SENDER_ID` | Non-secret var (after approval) | Placeholder comments only | Same |
| `MIKROTIK_CONNECTOR_SECRET` | Worker secret | Never | Validated when URL set |
| `MIKROTIK_CONNECTOR_URL` | Var/secret after Tunnel hostname known | Placeholder | HTTPS required in prod/staging |

Placeholder commands only:

```bash
npx wrangler secret put ARKESEL_API_KEY --env production
npx wrangler secret put MIKROTIK_CONNECTOR_SECRET --env production
```

No real secrets in docs, logs, frontend, or source maps.

---

## 3. Distributed rate limiting

| Layer | Surfaces | Topology | Status |
| --- | --- | --- | --- |
| Isolate Map | Staff login (IP + identity), OTP request/verify (IP + identity), admin writes (IP) | **isolate-local — NOT distributed** | IMPLEMENTED AND TESTED |
| D1 | OTP request counts; staff login failure counts; OTP `attempt_count` | Durable, multi-isolate improve | IMPLEMENTED AND TESTED (Phase 1 + preserved) |
| Cloudflare edge | Login / OTP / admin | Edge-global | PRODUCTION DASHBOARD ACTION REQUIRED — see `docs/examples/cloudflare-edge-rate-limits.example.md` |

Protected paths: `/auth/staff/login`, `/auth/resident/request-otp`, `/auth/resident/verify-otp`, admin POST/PATCH/DELETE.  
No permanent lockouts (windows expire). D1 OTP controls **not** weakened.

---

## 4. WAF / edge protection plan

**PRODUCTION DASHBOARD ACTION REQUIRED** (not active)

Recommended:

- Cloudflare Managed Ruleset (default + WordPress-like noise off if unused)
- Bot Fight Mode / Super Bot Fight — start in *challenge* for a small hostel
- Block uncommon methods on API if unused (TRACE/TRACK)
- Max request body ~6 MiB (uploads capped at 5 MiB in app)
- Custom rules: challenge high-rate auth paths; protect `/admin/*`

Do **not** claim WAF is active until verified in dashboard.

---

## 5. TLS / HTTPS / HSTS

| Control | Status |
| --- | --- |
| Production URLs use HTTPS in defaults | CONFIGURATION PREPARED |
| Zone SSL Full (Strict) | PRODUCTION DASHBOARD ACTION REQUIRED |
| HTTPS-only / always-use-HTTPS | PRODUCTION DASHBOARD ACTION REQUIRED |
| Modern TLS (1.2+) | PRODUCTION DASHBOARD ACTION REQUIRED |
| Mixed content | Portal CSP `upgrade-insecure-requests` in examples |
| **HSTS in Worker** | **Not set** (avoid premature brick) — IMPLEMENTED AND TESTED (absence) |
| HSTS at edge | Enable **only after** production HTTPS + domains verified — PRODUCTION DASHBOARD ACTION REQUIRED |

---

## 6. Security headers and CSP

### API (Worker) — IMPLEMENTED AND TESTED

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- CSP: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`
- `Cross-Origin-Resource-Policy: same-site`
- `Cross-Origin-Opener-Policy: same-origin`
- `Cache-Control: no-store` (+ Pragma) on `/auth`, `/admin`, `/resident`

### Portals (Pages) — CONFIGURATION PREPARED

Examples: `docs/examples/cloudflare-pages-headers.{resident,admin}.example`  
Avoid wildcards; avoid `unsafe-eval`; `connect-src` limited to self + `https://api.kissmetgroup.org`.

---

## 7. CORS production lockdown — IMPLEMENTED AND TESTED

Trusted conceptual domains: `kissmetgroup.org`, `portal.`, `admin.`, `api.` (DNS **not** assumed configured).

- Production allowlist: `https://admin.kissmetgroup.org`, `https://portal.kissmetgroup.org`
- No arbitrary reflection; no `*` + credentials
- Localhost/http/wildcards stripped in production/staging even if misconfigured

---

## 8. D1 production security

| Topic | Status |
| --- | --- |
| Worker-only access via binding | CONFIGURATION PREPARED (platform model) |
| No browser DB credentials | IMPLEMENTED (architecture) |
| Migrations via wrangler per env | CONFIGURATION PREPARED — **do not run destructive production migrations from this PR** |
| Deliberate prod migrate | Operator checklist |
| Backup | `wrangler d1 export` / dashboard backup — CONFIGURATION PREPARED |
| Restore procedure | Documented below |
| Restore drill | **PENDING** — launch gate |

### Backup procedure (CONFIGURATION PREPARED)

1. Identify production D1 database id (dashboard).
2. Export: `npx wrangler d1 export <DB_NAME> --env production --output ./backups/d1-YYYYMMDD.sql` (store offline; **no secrets in SQL comments you add**).
3. Encrypt at rest in operator backup store.
4. Record schema migration version.

### Restore procedure (drill PENDING)

1. Restore into a **new** D1 or staging clone first.
2. Validate row counts for residents, payments, receipts, otp_codes (hashes only), sessions.
3. Point staging Worker; run health + smoke auth.
4. Only then consider production cutover.
5. **Actual restore drill status:** PENDING — PHYSICAL/OPERATOR COMMISSIONING.

---

## 9. R2 production security

| Control | Status |
| --- | --- |
| Private buckets (no public URL) | CONFIGURATION PREPARED + app never emits public Student/Ghana Card/slip URLs |
| Authorized Worker downloads | IMPLEMENTED (admin authz + attachment headers) |
| Cache / disposition / nosniff | IMPLEMENTED AND TESTED |
| Naming | Sanitized keys (Phase 1) |

---

## 10. Upload malware-risk strategy

**Preserve:** size 5 MiB, MIME+extension allowlist, dangerous ext deny, sanitized names, attachment disposition, nosniff, authz.

| Decision | Status |
| --- | --- |
| Content malware scanner at launch | **Not auto-added** (cost/complexity) — DEFERRED / accepted residual risk for initial launch |
| Residual risk | Malicious PDF/image content possible despite type checks — MEDIUM residual, accepted with authz + private R2 |
| Future upgrade | Optional async AV / Cloudflare / third-party scan later |

---

## 11. Production error handling — IMPLEMENTED AND TESTED

`publicErrorMessage` redacts SQL/D1/R2/stack/password/token/Arkesel/MikroTik/RouterOS/ports/bindings/secrets/Ghana Card.  
Auth misconfig returns generic 503 + correlation id (no secret names).

---

## 12. Logging / observability

| Control | Status |
| --- | --- |
| `safeLogFields` / redaction helper | IMPLEMENTED AND TESTED |
| Never log OTP/passwords/keys/tokens/Authorization/Ghana Card/upload bodies/MikroTik password/connector secrets | Policy + helper |
| Retention / privacy | Use Cloudflare Workers logs defaults; no expensive third-party APM auto-added — DEFERRED |
| Audit logs in D1 | Existing; metadata must not include secrets (identifierHash only for staff failures) |

---

## 13. Production domain / DNS checklist

**Live DNS configured: NO** (this PR does not change DNS).

| Hostname | Purpose | Commissioning |
| --- | --- | --- |
| kissmetgroup.org | Apex | Out of band |
| portal.kissmetgroup.org | Resident | DNS + Pages + TLS |
| admin.kissmetgroup.org | Admin | DNS + Pages + TLS |
| api.kissmetgroup.org | Worker route | DNS + Worker route + TLS |
| staging-* | Optional | Same pattern |

Align CORS/CSP/`PUBLIC_BASE_URL` after DNS. Health checks post-deploy.

---

## 14. Cloudflare DDoS / bot

| Capability | Status |
| --- | --- |
| L3/L4 DDoS (Cloudflare included) | Platform default when proxied — **not verified active for Kissmet zone** until DNS proxied |
| Bot Fight / WAF | Extra config — PRODUCTION DASHBOARD ACTION REQUIRED |
| Proportionate for small hostel | Prefer challenge over hard bans; avoid enterprise overbuy — documented |

---

## 15. Raspberry Pi security preparation

**PHYSICAL COMMISSIONING REQUIRED** — checklist in `PRODUCTION_SECURITY_CHECKLIST.md` and `mikrotik-connector/MIKROTIK_CONNECTOR_DEPLOYMENT.md`.

Highlights: 64-bit OS, updates, SSH keys only, firewall, unprivileged user, systemd hardening, secrets `0600` at `/etc/kissmet/mikrotik-connector.env`, restart policy, log rotation, time sync, Ethernet, reserved IP, UPS, rebuild runbook.  
**No real SSH keys or credentials in this repo.**

---

## 16. Cloudflare ↔ Pi connector security

| Topic | Status |
| --- | --- |
| Bearer auth (timing-safe) | Implemented in connector package (prior work) |
| Replay/freshness | Correlation id present; no signed timestamp protocol yet — DEFERRED enhancement |
| TLS / Tunnel | HTTPS required in prod Worker client; Tunnel commissioning — PHYSICAL COMMISSIONING REQUIRED |
| Least inbound surface | No public RouterOS; Tunnel outbound preferred |
| Fail-closed / timeouts / safe errors | IMPLEMENTED in Worker client |
| Secret rotation | Documented operator step |
| Tunnel active | **Not pretended** — PHYSICAL COMMISSIONING REQUIRED |

---

## 17. MikroTik production boundary

**Do not modify live router from this PR.**

| Control | Status |
| --- | --- |
| `portal-api` least privilege preserved | Documented — PHYSICAL COMMISSIONING REQUIRED to verify |
| `Kissmet-Residents` shared-users=3; `default` untouched | Documented |
| D1 source of truth for portal | Architecture |
| Dev `.5` Allowed Address → plan: set production Allowed Address to **specific Pi LAN IP**; optional keep `.5` for intentional **dev** only; **no** broad subnet; **no** public 8728/8729 | PHYSICAL COMMISSIONING REQUIRED |

---

## 18. API vs API-SSL (8728 / 8729)

| Path | Status |
| --- | --- |
| 8728 API | Validated in prior work on current path |
| 8729 API-SSL | Certificate **not** validated |
| Decision | **A:** private LAN + source IP restriction on 8728, **or** **B:** validate API-SSL certs then prefer 8729 |
| Action | Do **not** disable working 8728 until alternative validated — final choice during commissioning — PHYSICAL COMMISSIONING REQUIRED |

---

## 19. Backup / recovery

Covered: D1, R2 inventory, app config (git), Pi rebuild, connector env (offline), MikroTik export.  
**No secrets in docs backups.** Restore drill = launch gate (**PENDING**).

---

## Tests executed (this phase)

| Suite | Expected |
| --- | --- |
| `cloudflare` vitest (incl. Phase 1 + Phase 2) | Pass |
| `cloudflare` typecheck | Pass |
| `resident-frontend` vitest + build | Pass |
| `admin-frontend` vitest + build | Pass |

---

## Residual risks / unresolved before production

1. Edge WAF / rate limits / HSTS / DNS not applied (dashboard).
2. Production D1/R2 IDs still placeholders.
3. Pi + Tunnel + MikroTik Allowed Address not commissioned.
4. D1 restore drill not performed.
5. Upload content malware scanning deferred.
6. Portal CSP `_headers` not yet deployed to Pages.
7. Connector replay/freshness signing not implemented.
8. Wrangler toolchain npm audit findings deferred (Phase 1).

## Overall

**READY FOR REVIEW** — Phase 2 repo hardening + honest commissioning docs; no merge/deploy/DNS/MikroTik/SMS performed.
