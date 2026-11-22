# Prioritised implementation plan — next portal work (2026-11-22)

Scope requested: refund redesign, admin connector-status card, document access, gender-restricted allocation, frontend
performance. Findings come from reading the current code on `feature/pi-connector`. Effort is in focused engineering days
(incl. tests). Nothing here is implemented yet.

## Recommended order

| # | Item | Why this position | Effort | Risk |
|---|---|---|---|---|
| 1 | Refund redesign — phase A (integrity fix) | A live financial-integrity gap exists today (below) | 1 d | Low |
| 2 | Gender-restricted allocation hardening | Safety/policy issue; small, contained change | 1–1.5 d | Low–med |
| 3 | Document access tightening | Privacy (Ghana Card); mostly server-side | 1.5–2 d | Low |
| 4 | Admin connector-status card | Needed for Pi commissioning visibility; depends on 0020 applied remotely | 1 d | Low |
| 5 | Refund redesign — phase B (refund records, partial refunds, receipts) | Needs product decisions + migration 0021 | 3–4 d | Medium |
| 6 | Frontend performance | No correctness impact; quick wins first | 1–1.5 d | Low |
| — | Self-service staff password change (found while building the bootstrap) | Bootstrap temp password otherwise never rotates | 0.5–1 d | Low |

## 1 + 5. Refund redesign

**Today** (`admin.service.ts` `refundPayment`, `updatePaymentStatus`; routes `POST /admin/payments/:id/refund`,
`PATCH /admin/payments/:id/status`):
- A refund is just `payments.status: verified → refunded` for the **whole** payment. No partial refunds, no refund amount,
  method, reference, payee, or date paid out; notes overwrite `payments.notes`.
- **Defect:** `PATCH /admin/payments/:id/status` with `status: "refunded"` (allowed by the `verified → refunded` transition
  map) skips the logic in `refundPayment` that flags `payment_attention_required` when a confirmed booking drops below its
  confirmation threshold. Two code paths, different outcomes.
- The payment's issued receipt stays `issued`; voiding is a separate manual step (`voidReceipt`).
- Same permission (`payment:verify`) requests and executes a refund — no maker/checker.
- Residents see no refund state; finance report sums `refunded` payments only.

**Phase A (now, no migration):** remove `refunded` from the generic status transition (or route it through
`refundPayment`); require a reason; in the same batch void the active receipt (or block refund until voided — decision);
tests for both routes. 
**Phase B (migration 0021):** `refunds` table (`payment_id`, `amount_minor` ≤ refundable remainder, `method`, `reference`,
`reason`, `status requested|approved|paid|cancelled`, `requested_by`, `approved_by` ≠ requester, timestamps); payment
summary uses `verified − refunded` amounts; partial refund keeps payment `verified`, full refund sets `refunded`; refund
receipt/credit note numbering; resident read-only view; finance report by refund status. 
Dependencies: product decisions (partial refunds? maintenance fee non-refundable — 0015 already models it; who approves).
Risks: booking payment-summary math used across confirmation/renewal (2L-J/2L-K) — needs real-schema E2E tests like 2L-L.

## 2. Gender-restricted allocation

**Today:** rooms have `gender_policy female|male|any`; residents have `gender female|male|other|not_specified|NULL`.
Available-bed queries use `(r.gender_policy = 'any' OR ? IS NULL OR r.gender_policy = ?)` and the bed check at
`admin.service.ts` ~L3069 skips the check when gender is NULL — so a resident with **no gender recorded can be placed in a
single-gender room**. Room approval (`priced_room_id`, ~L1610/1640), renewals, extensions and cross-room transfers need to be
checked for the same rule.
**Plan:** one `assertGenderAllowed(room, resident)` helper used by approval, allocation, transfer, cross-room transfer and
renewal; policy decision for `NULL` / `other` / `not_specified` (recommend: only `any` rooms unless an admin override with
reason, audited); DB-level guard is not practical in SQLite without triggers — keep it in the service with tests on every
path; admin UI shows the reason a bed is filtered out; resident registration makes gender required (decision).
Risk: existing residents with NULL gender become unplaceable in single-gender rooms — run a read-only count first.

## 3. Document access

**Today:** R2 is private, Worker-only. `GET /admin/documents` (`document:read`, held by reception) lists **all** student-card
and Ghana-card metadata; content of a Ghana card requires `document:ghana_card` and is audited
(`admin.identity_document.accessed`). Payment slips are uploaded under `payment:write`; there is no dedicated admin read path
for slips/receipt PDFs beyond the payment screens.
**Plan:** filter Ghana-card rows out of the list unless the caller has `document:ghana_card`; audit list access as well as
content access; short-lived signed download (or stream with `Cache-Control: no-store`, `Content-Disposition: attachment`,
already used) and per-document "last accessed by"; slip/receipt read endpoints with `payment:read` + audit; resident can see
and replace own rejected documents only; retention rule (archive identity docs N months after checkout — decision).
Risk: low; admin UI needs to handle 403 on Ghana-card items for reception.

## 4. Admin connector-status card

**Today:** Worker has `GET /admin/internet-access/connector-health` (live probe through the connector, used by the Internet
Access page) and, from the pre-Pi prep, `GET /admin/internet-access/connector-status` (heartbeat-based, from D1 table
`connector_heartbeats`, migration 0020) — **not yet used by the admin UI**.
**Plan:** dashboard + Internet Access card showing: configured yes/no, last heartbeat age (green < 2 min, amber < stale
threshold, red stale/never), connector version, RouterOS reachability from the last heartbeat, last live probe result on
demand (button, rate-limited), "not configured" state for staging. No secrets/URLs shown. Tests with mocked API.
Dependency: 0020 applied in the target DB; Pi heartbeat service running (hardware).

## 6. Frontend performance

**Today:** Admin build is one 605 kB JS chunk (151 kB gzip) — every page imported eagerly in `AppRoutes.tsx`, no
`React.lazy`. Resident build ships `hostel-illustration.png` (2.37 MB, login + register) and `hostel-dashboard.png`
(2.15 MB, home) plus two ~450 kB logo PNGs. `www/` has 2.3 MB originals (not shipped if unused).
**Plan:** route-level `React.lazy` + `Suspense` per page in Admin (expect initial chunk < 250 kB), `manualChunks` for
react/react-dom/router; convert images to AVIF/WebP at display size (target < 200 kB each, logos as SVG or < 30 kB PNG),
`loading="lazy"`/`fetchpriority` on the hero, explicit width/height; long-cache headers for hashed assets on Pages;
build-time guard that fails a production build when `VITE_API_BASE_URL` is unset (clients currently fall back to
`http://localhost:8787`). Add a bundle-size check to CI.

## Other open items noted

- Hono/@hono/node-server upgraded (this PR); remaining Worker advisories are all in `wrangler@3` dev tooling → plan a
  `wrangler@4` upgrade (major; re-test `wrangler dev`, D1 local, `migrations` commands).
- Self-service staff password change + forced change after a reset/bootstrap temp password. **Implemented on branch `feat/staff-password-change` (migration 0021).**
- Mobile-money payments and email delivery remain unbuilt (from the pre-Pi report).
