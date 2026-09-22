# Kissmet Production Security — Phase 1 (Application & API Hardening)

**Branch:** `security-phase1-app-api-hardening`  
**Base:** `main` @ `d7d74b6` (OTP Phase 1 merged)  
**Scope:** Application / API security only. Raspberry Pi / MikroTik / network hardening is deferred.  
**Deploy / merge:** Not performed in this phase.

## Methodology

1. **AUDIT** — Review auth, sessions, RBAC, resident isolation, admin object authorization, D1/SQL, payments, R2 uploads, validation/injection, CORS/CSRF, security headers, rate limiting, secrets, logging, dependencies, business-rule abuse, Internet Access application boundary.
2. **FINDINGS** — Classify CRITICAL / HIGH / MEDIUM / LOW / INFO; distinguish confirmed vulnerabilities vs hardening vs production-edge requirements vs deferred infrastructure.
3. **FIX** — Prefer confirmed HIGH/CRITICAL; apply safe MEDIUM hardening in-app without silent business-rule changes.
4. **SECURITY TEST** — Add negative regression coverage for fixed issues and broad authorization boundaries.
5. **REGRESSION TEST** — Full backend Vitest + resident/admin frontend tests and production builds.
6. **RE-AUDIT** — Confirm remediations and document residual risk.
7. **PR** — Open for review only (no merge, no deploy).

Local/test fixtures only. No live Arkesel SMS, real resident data, real secrets, Ghana Card numbers, or production destructive tests.

---

## Authorization matrix (from actual routes)

| Capability / area | Super Admin | Manager | Reception | Accounts | Maintenance | Resident |
| --- | --- | --- | --- | --- | --- | --- |
| Admin dashboards / setup write | ✓ (`*`) | ✓ (`admin:*`) | read-ish limited | — | — | — |
| Residents R/W | ✓ | ✓ | ✓ | — | — | self only via `/resident/me` |
| Applications | ✓ | ✓ | ✓ | — | — | own |
| Bookings write | ✓ | ✓ | ✓ | — | — | read own |
| Booking confirm | ✓ | ✓ | — | ✓ | — | — |
| Allocations | ✓ | ✓ | ✓ | — | — | read own |
| Payments write | ✓ | ✓ | ✓ | ✓ | — | create/submit own |
| Payment verify / reject / refund | ✓ | ✓ | — | ✓ | — | — |
| Receipts write/void | ✓ | ✓ | — | ✓ | — | read own |
| Documents (identity) | ✓ | ✓ | ✓ | — | — | own upload/list |
| Ghana Card content | ✓ | ✓ (`document:ghana_card`) | — | — | — | own metadata only |
| Maintenance | ✓ | full | create/assign | — | update/resolve | create/read own |
| Announcements publish | ✓ | ✓ | read | — | — | published portal |
| Messages send | ✓ | ✓ | ✓ | ✓ | ✓ | read own deliveries |
| Staff / settings mutate | ✓ only | settings read | — | — | — | — |
| Audit logs | ✓ | ✓ | — | — | — | — |
| Internet Access manage | ✓ | ✓ | — | — | — | read-only own status/sessions |
| Reports finance | ✓ | ✓ | ops reports | ✓ | ops reports | — |

**Enforcement:** Backend `requireAuth` + `requireStaff` on `/admin/*`; `requireAuth` + `requireResident` on `/resident/me/*`; fine-grained `requirePermission` / `requireRole` on sensitive routes. Frontend visibility is **not** security.

**Missing protections found (pre-fix) and addressed:**
- Staff sessions did not re-check `staff.status` on each request (revocation-dependent).
- Resident vs staff token separation relied only on `residentId` presence, not `userType`.
- Payment `PATCH .../status` allowed `rejected` with `payment:write` (reception), bypassing `payment:verify`.
- Document content responses lacked `Content-Disposition: attachment` and explicit `nosniff`.
- No application-level security headers middleware.

---

## Findings summary

| Severity | Count | Notes |
| --- | --- | --- |
| Critical | 0 | No realistic direct auth/admin/financial compromise confirmed in app layer |
| High | 0 | No confirmed HIGH left unfixed; privilege gaps closed as MEDIUM hardening |
| Medium | 4 fixed + 1 documented | See confirmed findings |
| Low | 3 fixed / documented | OTP bias, pagination NaN, registration OTP key case |
| Informational | several | Rate-limit topology, localStorage tokens, deps, edge config |

---

## Confirmed findings

### SEC-P1-001 — MEDIUM — Staff session did not re-validate staff row status
- **Affected:** `auth.middleware` / `AuthRepository.findSessionByTokenHash`
- **Evidence:** Middleware checked `user_status` and session status only. Inactive staff with an unrevoked session could continue until expiry.
- **Fix:** Select `staff_status`; reject staff sessions unless `staff_status === 'active'`; require staff/resident ids by `user_type`; clear cross-type ids on `AuthUser`.
- **Regression:** `auth.test.ts` inactive staff session; `security.phase1.test.ts` boundary tests.
- **Status:** Fixed

### SEC-P1-002 — MEDIUM — Resident/staff token boundary incomplete
- **Affected:** `/admin/*`, `/resident/me/*`
- **Evidence:** Admin used `requireAuth` only; resident used `residentId` checks in services. A confused identity (or staff token hitting resident routes) was not blocked at the route gate by `userType`.
- **Fix:** `requireStaff()` on all admin routes; `requireResident()` on resident `/me` routes; middleware clears opposite identity fields.
- **Regression:** `security.phase1.test.ts` resident↛staff / staff↛resident.
- **Status:** Fixed

### SEC-P1-003 — MEDIUM — Payment reject via PATCH gated by `payment:write`
- **Affected:** `PATCH /admin/payments/:id/status`
- **Evidence:** Reception has `payment:write` but not `payment:verify`. Workflow allowed `submitted → rejected` through PATCH, while dedicated reject route required `payment:verify`.
- **Fix:** Route requires `payment:verify` for `rejected` / `refunded` transitions (aligned with verify/reject/refund posts). Does not change allowed status graph.
- **Regression:** Covered by permission matrix assertions + existing payment workflow tests.
- **Status:** Fixed

### SEC-P1-004 — MEDIUM — Upload MIME trust + document download headers
- **Affected:** Resident/admin upload paths; `GET /admin/documents/:id/content`
- **Evidence:** Validation trusted `file.type` alone; content responses set `Content-Type` from stored client MIME without `Content-Disposition: attachment` / consistent `nosniff`.
- **Fix:** Shared `validateUploadFile` (MIME+extension allowlist, dangerous extension deny, size/filename sanitization). Download headers: attachment disposition, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- **Regression:** `security.phase1.test.ts` upload validation; resident upload negative tests updated.
- **Status:** Fixed  
- **Residual:** No malware content scanning platform (INFO / accepted).

### SEC-P1-005 — MEDIUM — Missing API security headers
- **Affected:** Worker responses globally
- **Evidence:** No CSP / frame / nosniff / referrer / permissions / auth cache controls on API.
- **Fix:** `securityHeadersMiddleware` — nosniff, `X-Frame-Options: DENY`, referrer policy, permissions policy, API-oriented CSP (`default-src 'none'; frame-ancestors 'none'`), `Cache-Control: no-store` on `/auth`, `/admin`, `/resident`.
- **Regression:** `security.phase1.test.ts` headers test.
- **Status:** Fixed  
- **Production-edge:** HSTS and zone TLS remain Cloudflare edge requirements (deferred infrastructure / launch config).

### SEC-P1-006 — LOW — OTP digit modulo bias
- **Affected:** `randomOtp`
- **Evidence:** `byte % 10` slightly biases digits 0–5.
- **Fix:** Rejection sampling (`byte >= 250` discarded).
- **Regression:** OTP format tests.
- **Status:** Fixed

### SEC-P1-007 — LOW — Registration OTP rate-limit key case mismatch
- **Affected:** `ResidentService.verifyRegistrationOtp`
- **Evidence:** Request keyed by DB `institution.code`; verify used raw client casing → failed verify / inconsistent rate keys.
- **Fix:** Resolve active institution by `lower(code)` before key lookup.
- **Status:** Fixed

### SEC-P1-008 — LOW — Pagination NaN / non-finite inputs
- **Affected:** `pagination()`
- **Evidence:** `Number("NaN")` could produce non-finite LIMIT/OFFSET binds.
- **Fix:** Finite checks with safe defaults.
- **Status:** Fixed

### SEC-P1-009 — INFO — Staff login limiter topology
- **Affected:** `checkRateLimit` (isolate Map) + new D1 failure counter
- **Evidence:** Pure in-memory Map is not distributed across Worker isolates.
- **Fix:** Keep isolate Map; add D1-backed count of recent `auth.staff.login_failed` by `identifierHash` metadata (app-level improvement). **Still not** Cloudflare edge / global distributed limiting — mark as launch-required.
- **Status:** Hardened + documented

### SEC-P1-010 — INFO — Frontend bearer tokens in `localStorage`
- **Affected:** Admin `kissmet_admin_token`, Resident `kissmet_resident_token`
- **Evidence:** XSS in portal origin could steal tokens. React avoids `dangerouslySetInnerHTML`; CSP on **portal origins** is an edge/static hosting concern.
- **Status:** Documented implication (no cookie/CSRF redesign in this phase)

### SEC-P1-011 — INFO — Dependency advisories in Wrangler toolchain
- **Affected:** `cloudflare` package-lock transitive via `wrangler` (esbuild/miniflare/undici/ws/sharp)
- **Evidence:** `npm audit` reports moderate/high in **dev tooling**, not production Worker dependency `hono`. Fix wants major wrangler bump.
- **Status:** Deferred (avoid unrelated major upgrade). Admin/resident frontends: `npm audit` clean.

---

## Authentication / OTP

| Control | Status |
| --- | --- |
| Kissmet remains OTP authority | Yes (Arkesel transport only) |
| OTP plaintext storage | No (PBKDF2 hash) |
| OTP logging (production) | No production route; Mock/dev capture gated off production |
| Replay / single-use | `status = used` before session |
| Attempt / rate controls | Max attempts + D1 OTP rate keys (3 / 15 min) |
| Account enumeration | Generic success messages on request |
| Arkesel failure | 503 generic; no session |

## Session security

| Control | Status |
| --- | --- |
| Token generation | 32-byte CSPRNG hex |
| Storage | SHA-256 hash server-side only |
| Expiry | 8 hours server-side |
| Revocation | Logout; password reset; role/status changes revoke active sessions |
| Role/status changes | Revoke + staff_status checked on auth |
| Token leakage | Not in URLs; safe-error redacts token/password/SQL |

## Document / R2 security

| Control | Status |
| --- | --- |
| R2 private binding | Yes (no permanent public URLs in app) |
| Cross-resident access | Queries scoped by `actor.residentId` |
| Content/size validation | MIME+extension+size |
| Unsafe filenames | Sanitized keys + reject dangerous extensions |
| Residual upload risk | Malware scanning not in scope |

## Financial security

| Control | Status |
| --- | --- |
| Backend amount authority | Integer minor units; totals from DB rates |
| Verification permissions | `payment:verify` (manager/accounts/super_admin) |
| Receipt permissions | `receipt:write` |
| Concurrency | Verify UPDATE guarded by status + sum check |

## Secrets / config

| Item | Result |
| --- | --- |
| Committed real secrets found | **NO** (seed PBKDF2 hashes are local fixtures; `.dev.vars` gitignored) |
| Rotation required | **NO** |
| Real secret values printed | **NO** |
| Production missing SMS config | Fail-closed (`MisconfiguredSmsProvider`) |

## Rate limiting

| Surface | App behavior | Launch requirement |
| --- | --- | --- |
| OTP request | D1 count by rate_limit_key | Edge/distributed still recommended |
| OTP verify | attempt_count / max_attempts | — |
| Staff login | Isolate Map + D1 failure count | **Cloudflare/WAF or durable distributed limiter** |
| Uploads / reports | Size limits; pagination caps | Edge DoS controls |

## CORS / CSRF

- Explicit origin allowlist (`ADMIN_ALLOWED_ORIGINS` / defaults per `APP_ENV`).
- No wildcard + credentials pattern.
- Auth is **Bearer Authorization header** (not cookie session) → classic CSRF against cookie-authenticated browsers is **not applicable** to the API auth model. Cross-origin calls still require a stolen/valid bearer token.
- Do not add CSRF tokens blindly without changing auth architecture.

## Security headers / production edge

**Implemented in Worker:** nosniff, frame deny, referrer, permissions-policy, API CSP, no-store on authz paths, document download hardening.

**Production Cloudflare edge still required:**
- HSTS
- TLS settings
- Optional WAF / rate limiting rules
- Static portal CSP (Admin/Resident Pages/assets) separate from API CSP
- R2 bucket remains private; no public binds

## Internet Access application boundary

- Resident endpoints: read-only status/sessions; identity from session `residentId`.
- Staff mutations: `internet:manage` under `/admin` + `requireStaff`.
- RouterOS credentials never returned on resident payloads; one-time hotspot password only on staff provision/reset responses.
- Connector failures → sync_failed paths; accommodation workflows not altered by connector errors.
- No Pi/MikroTik/network config changes in this phase.

## Tests executed

| Suite | Result |
| --- | --- |
| `cloudflare` vitest | Pass (incl. `security.phase1.test.ts` — 15 new) |
| `cloudflare` typecheck | Pass |
| `resident-frontend` vitest + build | Pass |
| `admin-frontend` vitest + build | Pass |

## Remaining risks / unresolved before production

1. **Distributed / edge rate limiting** for staff login, OTP, and expensive admin reports (Worker isolate + D1 is not edge-global).
2. **Portal-origin CSP / XSS defense-in-depth** for `localStorage` bearer tokens (API CSP does not protect SPAs).
3. **Upload malware content scanning** not implemented (metadata validation only).
4. **Wrangler toolchain npm audit** findings deferred pending planned major upgrade.
5. Replace placeholder D1 database IDs and set production secrets (`ARKESEL_*`, `MIKROTIK_CONNECTOR_*`) via Wrangler secrets — fail-closed already coded.

## Deferred to infrastructure security phase

- Cloudflare production edge configuration (HSTS, WAF, edge rate limits, portal CSP)
- Raspberry Pi hardening
- MikroTik/RouterOS network exposure/firewall
- Production connector path commissioning
- Physical/network commissioning

## Overall

**READY FOR REVIEW** — Application/API Phase 1 hardening complete on branch; no merge/deploy performed.
