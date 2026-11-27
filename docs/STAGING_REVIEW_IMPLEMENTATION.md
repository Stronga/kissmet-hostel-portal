# Kissmet Hostel — consolidated staging review implementation tracker

Phase 0 audit and implementation plan. This file is the persistent tracker for the UX redesign and the work that follows it. It does not change product behaviour.

| | |
|---|---|
| Baseline | `main` at `0b66f49` (2026-11-27) |
| Latest migration on `main` | `0022_refund_records_credit_notes.sql` (merged in PR #31) |
| Open pull requests | none |
| GitHub issues | none |
| Prior staging-review IDs in the repo or on GitHub | none. `AUX-13`–`AUX-31` are **newly assigned** in this document |
| This phase | documentation only. No schema change, no deploy, no remote migration |

`docs/IMPLEMENTATION_PLAN_NEXT.md` and parts of `docs/STAGING_PLAN.md` are older than `main`. They still describe refund milestone 2 as an open branch and tell operators not to apply migration 0022. Both statements are stale: #31 is merged and 0022 is the current head migration. Those files are intentionally left unchanged in this phase.

## How to use this tracker

1. Do not start a later phase until the numbered decisions in [Decisions requiring confirmation](#decisions-requiring-confirmation) that block it are answered.
2. One row in the [PR register](#pr-register) is one pull request. Keep each PR inside the files and requirement IDs named on that row.
3. When a PR merges, set its status, link, and the requirement IDs it actually closed. Do not mark an ID done because the UI hides a control.
4. New requirement IDs continue at `AUX-32`. Do not reuse `AUX-1`–`AUX-12`; those numbers were not found and stay unassigned so a later discovery cannot collide.
5. Screenshot and acceptance rows are append-only.

Reference images used for this audit (not copied into the repo by this PR):

- Official Kissmet logo ident. Proportions stay as-is. Phase 1 derives tokens from it and from the palettes already shipped. It does not restyle the mark.
- Application Details modal: header and status, two-column applicant and accommodation request, supporting documents with download, two-column review and lease agreement, sticky footer (Archive / Close / Create Agreement).
- Proposed admin layout: command-centre dashboard, right-hand activity panel, finance cards, expandable nested tables, modal over the list. Sample colours, metrics, names, and money figures in that image are not requirements.

---

## Requirement IDs

No `AUX-*` string exists in the repository, in GitHub code search, or in issues or pull requests. Resident-portal phases `R1`–`R12` in `RESIDENT_FRONTEND.md` are historical delivery notes, not this review. `AUX-13` through `AUX-31` below are the IDs for this programme.

| ID | Spec | Requirement | On `main` today | Work |
|---|---|---|---|---|
| AUX-13 | §2, §15 | Shared design tokens: colour from the Kissmet mark and the existing portals, type, spacing, border, shadow, radius, states. Restrained. Do not copy the proposed-screen mock. | Three divergent palettes (admin, resident, `www`). No shared token file. | Frontend |
| AUX-14 | §2, §15 | Shared components: buttons, fields, selects, search/filter, status, summary cards, nested tables, pagination, modals, drawers, detail views, activity items, workflow steps, empty/loading/error, notifications, confirms, navigation. | Partial primitives in each app. Many controls are copied per page. No `Button`, no shared pagination, no nested table, no sticky modal footer. | Frontend |
| AUX-15 | §3 | Admin dashboard as an operational command centre. Real backend metrics only. Global totals, never the current page. Periods and sessions labeled. Cover residents, applicants, pipeline, bookings, agreements, payments, balances, occupancy, allocations, maintenance, internet, finance. | Global SQL exists for a subset (`AdminService.dashboard`, finance, applications, maintenance, occupancy, internet summary). Several command-centre counts do not exist. List pages label many cards “On Page” and compute them from the loaded rows. “Active Residents” counts `residents.status = 'resident'`, which self-registration never sets. | Backend + frontend |
| AUX-16 | §3 | Summary cards open the filtered record set, not a generic list. | `StatCard` is not clickable. List routes ignore query params. Status filters run in the browser on the current page of 25. `listOk` does not return a total (audit logs are the exception). | Backend + frontend |
| AUX-17 | §4 | Action centre data: events from the public site, resident portal, admin portal, and backend processes. Unread notification distinct from unresolved task. Backend decides eligibility and completion. No duplicate open tasks. Deleted, archived, and cancelled subjects degrade cleanly. **`audit_logs` are not this feed.** | No `notifications` table and no domain-event table. `audit_logs` is the security and operations audit. Messages and announcements are separate products. The top-bar bell has no handler. | **Migration 0023** + backend |
| AUX-18 | §4 | Action centre UI on the admin dashboard: collapsible right panel; Action required / All activity / Completed; priority; pagination; role-aware; each item opens the exact record. | Not built. | Frontend, after AUX-17 |
| AUX-19 | §5 | Guided workflows: stage, responsible role, prerequisites and blockers, one contextual primary action. The map is the backend transition map. No second state machine in the client. Sensitive actions stay explicit. | Transition maps live in services (and are copied for application actions in the admin UI). No shared progress component. | Frontend (+ small read endpoints if the maps are not already returned) |
| AUX-20 | §6 | Single-level nested tables where they add information: rooms→beds/occupants, residents→stay/payment summary, applications→documents/progress, bookings→agreement/payments, payments→receipts/refunds, maintenance→progress, internet→account/provisioning. No N+1. Search, filter, and pagination still work. Keyboard and narrow screens work. | All list tables are flat. Beds, documents, and recipients open inside modals. `listRoomBeds` exists; a row expander would call it per expanded row unless a batch read is added. | Backend + frontend |
| AUX-21 | §7 | Modals, drawers, and dedicated detail views. Application Details matches the reference layout, including document download and the sticky footer. | Application review is a scrolling `ConfirmDialog` (`max-w-2xl`) with sections for application, applicant, request, review, documents, agreement, and actions. Download and Create Agreement exist. Footer actions scroll away. No side drawer. No dedicated application route. | Frontend |
| AUX-22 | §8 | Admin information architecture: Overview, Residents & admissions, Accommodation, Finance, Operations, Communications, Administration & config. Collapsible desktop sidebar, mobile nav, return to the same filter and page. | Six groups in `navigation.ts` (Overview, Residents, Rooms, Finance, Operations, Administration). Groups do not collapse. Finance and some operations items are role-gated in the sidebar only; the router does not enforce the same gate. Filter and offset live in component state and are discarded on navigation. | Frontend |
| AUX-23 | §9 | Public Apply Now opens the resident portal and keeps the selected room type when that concept exists. | `www/index.html` is a coming-soon page. Admin and resident hosts are deliberately not linked. No room-type field is stored on an application. | Frontend, and a migration **only if** decision D4 adds a catalog |
| AUX-24 | §10 | Registration, OTP, profile, documents, and room-type-only selection. Residents do not pick a room or a bed. | Registration, OTP, profile, and documents exist. The application stores lease kind and lease period (“Requested Term”), not a room or bed. The only UI label “Room type” is My Room showing `room_gender_policy` (“Female occupancy”). Gender is not collected at registration. | Frontend, plus D4 / D9 |
| AUX-25 | §11 | Resolve the observed Draft vs Submitted discrepancy. | Investigated below. Not a lost update. Two-step create-then-submit, plus dashboard wording. | Frontend, small backend labeling. No migration |
| AUX-26 | §11 | One active application per period. A correction loop that sends an application back to the applicant and accepts a resubmit. | Partial unique indexes and service checks already block a second active application per session or lease period. There is no `corrections_required` status and no resubmit. | **Migration 0024** if D5 adds a status |
| AUX-27 | §11 | Cancelled and rejected applications keep reason, actor, and date; the resident sees an appropriate explanation and the history; reapply reuses valid profile and documents, issues a new reference, and does not delete payments, bookings, or refunds. | `decision_notes` and `reviewed_at` / `reviewed_by_staff_id` are set for review, approve, and reject. Cancel does not record an actor. Resident UI shows notes only for rejected. A rejected or cancelled row still hides “Start application” even though the API allows a new draft. | **Migration 0024** for cancel metadata + frontend |
| AUX-28 | §11 | Applicant-initiated withdrawal. | No resident cancel route. Staff may cancel only from `draft` or `submitted`. | Blocked on D2. Migration only if withdrawal is a new status |
| AUX-29 | §12, §13 | Resident portal stages from backend eligibility. Applicant: Home, Application, Profile, Documents, Messages, applicant announcements. Approved applicant adds Booking and Payments when eligible. Active resident adds My Room, Maintenance, Internet Access, resident announcements. Hiding a link in the client is not the control. | Every authenticated resident sees all ten destinations. Announcements are one published feed (`audience` all/residents), not split by stage. Maintenance create and internet provisioning already require an active allocation on the server. | Backend eligibility read model + frontend. No migration if the rules are derived |
| AUX-30 | §13 | Moving into the full resident experience must not contradict allocation, confirmation, or any check-in rule. Former residents keep financial history, receipts, and refunds. | No check-in record. Allocation requires a confirmed booking; confirmation requires the payment threshold. `residents.status` is not updated on allocation or move-out, so dashboard “Active Residents” does not follow occupancy. Payment, receipt, and refund lists are already resident-scoped and not deleted on move-out. The payment **summary** is only the current pending or confirmed booking. | Blocked on D3. Column already exists if status promotion is chosen |
| AUX-31 | §14 | Financial and accommodation safeguards: partial and full refunds, independent approval, no legacy refund shortcut, maintenance-fee protection, previous and pending refunds, concurrency, payout references, receipts and credit notes, payment-attention, archive rules, gender-restricted allocation, audited gender correction, allocation conflicts. | Refund milestone 2, gender rules, and allocation overlap checks are on `main`. Maintenance-fee protection is **documented and not enforced** on the refundable amount. See D1. | Mostly verification. Refund maths change only if D1 reverses PR #31, which would be **migration 0026** only if a new column is required |

Section 16 (screen inventory and capture) is delivery work `P6.2`, not a product requirement ID.

---

## Decisions requiring confirmation

These are business or policy choices. Implementation of the blocked phase waits for an answer. Proposed defaults are what `main` already does, so “keep current behaviour” is always an explicit option.

### D1. Maintenance fee on refunds — blocks Phase 6 refund maths (not Phases 1–5)

Section 14 asks for non-refundable maintenance-fee protection. On `main`:

- Migration 0015 defines `bookings.maintenance_fee_minor` as a non-refundable snapshot. `agreement-financial.ts` adds it to the **obligation** (what the resident must pay) and does not add it to verified payments.
- Refund milestone 2 (PR #31, merged) sets the refundable remainder to `payment.amount_minor − paid refunds − open refunds`. The 0022 trigger `refunds_within_payment_amount` uses the same ceiling. The fee is not subtracted.
- `docs/IMPLEMENTATION_PLAN_NEXT.md` records why: the fee is not attributed to a particular payment, so milestone 2 did not deduct it. That was the choice taken on the branch that became #31.

**Confirm one:**

- **D1-A (current `main`):** leave refund maths unchanged. The fee stays non-refundable only as an obligation concept. A verified payment can still be refunded in full.
- **D1-B:** reserve the fee. A booking’s payments may be refunded only down to `maintenance_fee_minor` (or another rule you specify). This changes `RefundService.refundable` and needs tests against partial payments. A new column is migration 0026 only if the fee must be stored on the payment rather than read from the booking.

Phases 1–5 do not change refund amounts.

### D2. Applicant self-withdrawal — blocks AUX-28 (Phase 4)

There is no resident withdraw endpoint. Staff `PATCH /admin/applications/:id/status` may set `cancelled` only from `draft` or `submitted`. `under_review` can only go to `approved` or `rejected`.

**Confirm:**

- May an applicant withdraw, and from which statuses (`draft` only, or also `submitted` / `under_review`)?
- Is the stored status `cancelled` with actor = resident, or a new `withdrawn` value (that forces a table rebuild)?
- May staff cancel an application that is already `under_review`?
- Withdrawal must not delete payments, bookings, or refunds. None of those exist before approval today (a booking requires `approved`).

### D3. When someone becomes an active resident — blocks AUX-30 (Phase 5)

Self-registration inserts `residents.status = 'applicant'` (`resident.service.ts`). No service updates that column to `resident` or `past_resident`. Admin create-resident may set an initial status; there is no later status route for residents.

Consequences on `main`:

- Dashboard “Active Residents” is `COUNT(*) WHERE status = 'resident'`. Occupied beds are `COUNT(*)` of `allocations.status = 'active'`. For self-registered people those numbers diverge after a real allocation.
- Messaging groups `current_residents` and `applicants` use the same unused status.
- There is no check-in table. The enforced order is: approved application → pending booking → verified payment meets the threshold → staff confirms the booking → staff allocates a bed (`PAYMENTS_RECEIPTS.md`).
- The resident shell does not consult status or allocation. Maintenance creation and admin internet provisioning do require an active allocation.

**Confirm which event promotes `residents.status` to `resident`, and which event sets `past_resident`:**

- **D3-A:** at bed allocation, and `past_resident` when the last active allocation ends. Portal “active resident” modules follow allocation, which matches the existing maintenance and internet rules. No check-in is introduced.
- **D3-B:** keep `residents.status` manual (or unused) and drive the portal only from application, booking, and allocation. Dashboard “Active Residents” must then be redefined so it stops reading a status nothing sets.
- **D3-C:** add a distinct check-in step after allocation. That is new product surface and should not be folded into the allocation transaction without this answer.

Ending an allocation must not delete historical payments, receipts, refunds, or credit notes. It does not do so today.

### D4. What “room type” means — blocks AUX-23 and the selection half of AUX-24 (Phase 5)

Applications have `lease_kind` and `lease_period_id` only. Rooms have `capacity` and `gender_policy`, not a type code. Residents already cannot choose a room or a bed. My Room labels gender policy as “Room type”.

**Confirm:**

- **D4-A:** “room type” in the brief means Requested Term (Academic Calendar, Calendar Year, Short-Term). Apply Now passes that term. No migration.
- **D4-B:** it means a new catalog (for example shared room vs private room) that is not gender and not the lease term. That is migration 0025 and a public-site selector. It is still not a room or bed id.
- **D4-C:** it means gender occupancy. That conflicts with fail-closed gender allocation (D9) and with the current label bug. Not recommended unless you explicitly want applicants to choose a gendered room class.

### D5. Corrections loop — blocks AUX-26 (Phase 4)

After submit, the resident cannot edit the application. Staff cannot send it back. Rejected identity documents can be re-uploaded, but that does not reopen the application. `submitted` may move to `under_review` or `cancelled` only.

**Confirm:**

- **D5-A:** add `corrections_required` (migration 0024 rebuilds the `applications` CHECK), with a defined return path to `submitted`, who may request corrections, and whether documents must be re-checked.
- **D5-B:** no in-place correction. Staff reject; the resident reapply flow (AUX-27) starts a new reference. Smaller, but it is not a correction workflow.

### D6. Shared colour primary — blocks AUX-13 token lock (Phase 1 can draft, not ship a rebrand)

Shipped values:

| Surface | Primary | Other |
|---|---|---|
| Admin (`admin-frontend/src/styles/index.css`) | `#1f6f78` | success `#138a55`, warning `#a86405`, danger `#c2413a` |
| Resident | `#056268` | accent gold `#d99f35`, success `#127b55`, warning `#c7691a`, danger `#c2413a` |
| `www` coming-soon | — | gold `#b8860b`, red `#c62828`, green `#2e7d32` |
| Logo ident | forest green laurels, gold/beige ring, red marks, black star, orange and green swooshes | not sampled into hex in this phase |

**Confirm D6-A as the Phase 1 default unless you say otherwise:** one operational teal taken from the resident primary (`#056268`), gold used only as a sparse accent, red only for destructive and failed states, admin and resident neutrals reconciled. Do not repaint the portals with the coming-soon gold/red/green set, and do not use the colours in the proposed-screen mock. The logo artwork is unchanged.

### D7. Who sees which action-centre items — blocks AUX-17 seed rules (Phase 2)

`audit_logs` stay on the Audit Logs screen for `super_admin` and `manager` (`audit:read`). They will not be copied into the staff activity feed. Task rows will be a new table written by domain transitions.

**Confirm the role matrix** (proposed, matching permissions already in `cloudflare/src/auth/permissions.ts`):

| Task examples | Roles |
|---|---|
| New or resubmitted application, documents to review, application awaiting decision | reception, manager, super_admin |
| Agreement to prepare, booking awaiting allocation | reception, manager, super_admin (`booking:write` / `allocation:write`) |
| Payment to verify, refund to approve | accounts, manager, super_admin |
| Maintenance, urgent maintenance | maintenance, manager, super_admin |
| Internet provisioning failure | manager, super_admin (`internet:read`) |
| Resident message needing a reply | roles that already have `message:read` for that target |

Reception must not see refund payout tasks. Maintenance must not see payment amounts. Public enquiries have nowhere to land until D8.

### D8. Public enquiries — blocks the “enquiries” row of AUX-17

The public site has no form, and there is no enquiry table. **Confirm** whether this programme includes a public enquiry that creates an action-centre task, or whether enquiries stay out of scope until the public site is redesigned on its own.

### D9. Gender at registration — blocks a smooth AUX-24 / AUX-31 allocation path

Single-gender rooms accept only `female` or `male`. `NULL`, `other`, and `not_specified` are refused (`gender-eligibility.ts`). Registration and profile do not collect gender. An applicant can be approved and then be unblockable for every single-gender room until a staff member with `resident:gender_correct` records a gender (audited, with conflict acknowledgement).

**Confirm:** require `female` or `male` at registration, or keep gender staff-entered. The fail-closed allocation rule itself should stay.

### D10. Dashboard period label — blocks AUX-15 card copy (Phase 2)

`GET /admin/dashboard` totals are global. The page header still prints one “Active session” name, which reads as if the counts were for that session. Calendar-year and short-term applications store `academic_session_id` NULL, so a silent filter on the active academic session would drop them. `applicationBookingReport` can take `academicSessionId`; the dashboard does not pass it.

**Confirm D10-A:** cards say “All periods” unless the user picks a period, and a period filter is explicit. Do not scope the command centre to the single active academic session by default.

---

## Draft vs Submitted investigation

**Result:** the two statuses are written on purpose, in one column, by two different requests. This is not a read-after-write or list-versus-detail defect in the code on `main`. The discrepancy people can see comes from the two-step resident flow and from dashboard wording that calls only `submitted` “pending” and does not show drafts.

### What the code does

1. Resident create (`POST /resident/me/applications`) inserts `status = 'draft'` and does not set `submitted_at` (`resident.service.ts`, `createApplication`).
2. Resident submit (`POST /resident/me/applications/:id/submit`) refuses anything other than `draft`, checks phone, name, resident kind, student or Ghana Card identity, and uploaded-or-verified identity documents, then runs one `UPDATE` that sets **both** `status = 'submitted'` and `submitted_at`. It re-reads that row.
3. Admin create also inserts `draft`. Admin `PATCH /admin/applications/:id/status` may move `draft → submitted` **without** those completeness checks, and sets `submitted_at` in the same statement.
4. List and detail for a resident read `applications.status`. The admin list is `SELECT * FROM applications`. There is no second status column and no HTTP cache of the list in the Worker.
5. The resident page does not optimistically mark the application submitted. After a successful submit it shows “Application submitted.” and then `load()` (`ApplicationPage.tsx`, `submitDraft`). A failed submit leaves the previous status on screen and shows the error. Tests expect a failed submit to remain Draft.
6. Allowed transitions (`admin.service.ts`):

```text
draft → submitted | cancelled | archived
submitted → under_review | cancelled
under_review → approved | rejected
approved | rejected | cancelled → archived
archived → (none)
```

There is no writer that sets `submitted_at` while leaving `status = 'draft'`.

### Why a staging pass can still look wrong

- **“Start application” is not submit.** The button creates a draft and the success text is “Draft application created.” Submit is a second button plus a confirm dialog, and it stays disabled until documents and profile are complete. A tester who treats Start as submit will see Draft. That matches the timing half of the report, and it is the UI copy, not a failed sync.
- **Incomplete submit stays Draft.** The API returns `Incomplete application` and does not change the row. Home and Application both show Draft because that is the row.
- **Dashboard language.** `pending_applications` is `COUNT(*) WHERE status = 'submitted'` only. The applications report also returns `draft_applications`, and the dashboard UI never renders that key. A draft therefore increments neither “Pending Applications” nor the applications panel, while the Applications table (filter All) shows Draft. “I applied and the dashboard still says nothing pending, and the row says Draft” is this gap.
- **Admin submit is a different operation** from resident submit. An admin-moved `submitted` row can lack the documents the resident endpoint requires.
- **Reapply is inverted in the client.** The latest row wins (`latestApplication` by highest id). The API allows a new draft after `rejected`, `cancelled`, or `archived`. The page sets `canCreate` only when there is no row at all, so a terminal application still blocks Start. That is a product bug for AUX-27, not a status-sync bug.

### What not to build

Do not add a client cache, a second status field, or a reconciler that flips Draft to Submitted. Phase 4 (`P4.1`, AUX-25) should make the two steps unmistakable, show draft counts on the dashboard, and keep submit completeness checks on the resident path only.

If a live staging row still disagrees with this finding, capture before any code change: application id, `status`, `submitted_at`, `updated_at`, and the audit actions `resident.application.created` and `resident.application.submitted` (or `admin.application.submitted`). Those two actions are the proof of which request ran.

---

## Phase 0–6 plan

Each row is one pull request, branched from `main` unless a note says it stacks. Phase 0 is this document. Phases 1–6 are not started here.

Migrations, when required, are the next numbers after 0022. Do not edit 0001–0022. Do not apply migrations to staging or production from these PRs; application stays a reviewed operator step.

| PR | Phase | IDs | Delivers | Migration |
|---|---|---|---|---|
| P0 | 0 | — | This tracker | none |
| P1.1 | 1 | AUX-13 | Token file used by admin and resident CSS variables. Logo unchanged. Default palette is D6-A until D6 is answered; ship only the confirmed values | none |
| P1.2 | 1 | AUX-14 | Admin primitives: button, field, select, search, status, empty/loading/error, pagination, confirm, modal shell with a sticky footer. Adopt on Application Details only as the proving page | none |
| P1.3 | 1 | AUX-14 | Resident primitives on the same tokens. No new shared package unless a later decision asks for one; tokens are one documented source copied into both apps | none |
| P2.1 | 2 | AUX-22 | Sidebar groups per §8, collapsible desktop groups, mobile drawer kept. Router still relies on each page for permission errors; add route-level blocks only where a page currently renders data the role must not see | none |
| P2.2 | 2 | AUX-16, AUX-22 | Server-side status (and session/period) filters on the list endpoints that cards will open. Persist filter, search, and offset in the URL. `pagination.total` on those lists. Remove client-side filtering of a single page | none |
| P2.3 | 2 | AUX-15, AUX-16 | Dashboard counts that SQL can already express, each labeled with its period (D10). Cards link to the filtered URL from P2.2. Retire “On Page” totals. Add: drafts, payments awaiting verification (count, not only sum), refunds in `requested`, confirmed bookings with no active allocation, approved applications with no booking, internet `sync_status = failed`. Do not invent a corrections count before D5 | none |
| P2.4 | 2 | AUX-17 | `staff_tasks` (name flexible) written by existing transitions. Dedupe key. Completion derived from the subject’s real status. Permission rules from D7. No insert from generic audit logging. Public enquiries only if D8 says yes | **0023** |
| P2.5 | 2 | AUX-18 | Dashboard panel: Action required, All activity, Completed. Unread vs unresolved. Pagination. Deep link to the record route or modal. Bell shows unread count for that role | none |
| P3.1 | 3 | AUX-21 | Application Details layout from the reference: identity header, status badge, applicant and accommodation columns, documents with the existing download, review and agreement columns, sticky Archive / Close / Create Agreement. Actions still call the current endpoints | none |
| P3.2 | 3 | AUX-21 | Same modal shell for booking and payment detail. A dedicated page only where the action centre must link to a URL that survives refresh | none |
| P3.3 | 3 | AUX-20 | Rooms → beds and current occupants from one aggregate read, not one request per row. Keyboard row toggle. Usable at 430px | none |
| P3.4 | 3 | AUX-20 | Nested rows for residents, applications, and bookings, same aggregate rule | none |
| P3.5 | 3 | AUX-20 | Nested rows for payments (receipts, refunds), maintenance, and internet accounts | none |
| P3.6 | 3 | AUX-19 | Read-only stage strip fed by the backend transition and by blockers the API already returns (incomplete application, gender, payment threshold). Primary button performs the existing explicit action. No auto-confirm, auto-allocate, auto-approve, or auto-refund | none |
| P4.1 | 4 | AUX-25 | Draft vs submit copy, disabled reason, dashboard draft count. No change to the two HTTP calls | none |
| P4.2 | 4 | AUX-26, AUX-27 | Depends on D5 and the cancel-metadata half of D2. Status rebuild and/or cancel actor, time, and resident-facing explanation. Resubmit or reapply per the decision. New application number on reapply. Do not cascade-delete money or bookings | **0024** |
| P4.3 | 4 | AUX-27 | Resident history for rejected and cancelled rows; Start application when the API would accept a new period application. Reuse profile and unrejected documents | none |
| P4.4 | 4 | AUX-28 | Resident withdrawal endpoint and UI. **Do not open until D2 is answered.** If D2 reuses `cancelled`, this PR has no migration | none, unless D2 adds `withdrawn` (then fold into 0024 before it ships) |
| P5.1 | 5 | AUX-23 | Public page: real Apply Now into the resident register/login, carrying the D4 selection. Coming-soon shell can stay until copy exists. **Blocked on D4** | **0025 only for D4-B** |
| P5.2 | 5 | AUX-24 | Registration and profile copy. No room or bed picker. Gender field only if D9 requires it | none |
| P5.3 | 5 | AUX-29 | `GET /resident/me/portal-access` (name flexible) computed from application, booking, and allocation. Server routes that already 403/400 stay the enforcement; the payload is not a second permission system | none |
| P5.4 | 5 | AUX-29 | Resident nav and announcement queries follow that payload. Applicant does not get maintenance or internet actions. Approved applicant gets booking and payments when a booking exists or the application is approved. Active resident modules follow D3 | none |
| P5.5 | 5 | AUX-30 | **Blocked on D3.** If D3-A, set `residents.status` in the allocation and allocation-end transactions and fix the dashboard definition in the same PR. If D3-B, change the dashboard metric only. If D3-C, stop and split check-in into its own plan | none (column exists) |
| P6.1 | 6 | AUX-31 | Confirm D1 in tests. D1-A: a regression test that a full refund of a payment is still allowed when the booking has a maintenance fee, plus a short note in `PAYMENTS_RECEIPTS.md`. D1-B: change `refundable` and the trigger behaviour only with a reviewed migration if a column is added. Do not do both | **0026 only for D1-B if a column is required** |
| P6.2 | 6 | §16 | Screen inventory and capture-tool update. See [Capture gaps](#screen-inventory-and-capture-gaps) | none |

Suggested merge order: P0, then P1.1 → P1.2 → P1.3, then P2.1 and P2.2 (P2.3 depends on P2.2), then P2.4 → P2.5, then P3.x, then P4.1 (can be earlier; it does not need the new modal), then P4.2 → P4.3 → P4.4, then P5, then P6. P6.1 can be done as soon as D1 is answered; it does not depend on the redesign.

Out of scope for every phase unless a decision adds it: Cloudflare, D1 remote apply, R2, the Pi connector, MikroTik, production bootstrap, and merging this tracker’s PR.

---

## Inventory

### Admin routes

File: `admin-frontend/src/routes/AppRoutes.tsx`. Auth gate: `ProtectedRoute` (session, and forced `/change-password`). Pages are lazy. Permissions are not on the route table; the sidebar hides some items and each page checks `hasPermission`.

| Path | Page |
|---|---|
| `/login` | `LoginPage` |
| `/change-password` | `ChangePasswordPage` |
| `/` | redirect `/dashboard` |
| `/dashboard` | `DashboardPage` |
| `/residents` | `ResidentsPage` |
| `/applications` | `ApplicationsPage` |
| `/bookings` | `BookingsPage` |
| `/rooms` | `RoomsPage` |
| `/allocations` | `AllocationsPage` |
| `/payments` | `PaymentsPage` |
| `/receipts` | `ReceiptsPage` |
| `/refunds` | `RefundsPage` |
| `/internet-access` | `InternetAccessPage` |
| `/maintenance` | `MaintenancePage` |
| `/announcements` | `AnnouncementsPage` |
| `/messages` | `MessagesPage` |
| `/reports` | `ReportsPage` |
| `/staff` | `StaffPage` |
| `/setup` | `SetupPage` |
| `/audit-logs` | `AuditLogsPage` |
| `/settings` | `SettingsPage` |

Sidebar today (`admin-frontend/src/components/layout/navigation.ts`):

| Group | Items | Role limit |
|---|---|---|
| Overview | Dashboard | any staff |
| Residents | Residents, Applications, Bookings | any staff |
| Rooms | Rooms & Beds, Allocations | any staff |
| Finance | Payments, Receipts, Refunds | super_admin, manager, accounts |
| Operations | Maintenance (all), Internet (super_admin, manager), Announcements (super_admin, manager, reception), Messaging (those plus accounts and maintenance), Reports (all) | mixed |
| Administration | Staff, Setup, Audit Logs, Settings | super_admin, manager |

Target groups for AUX-22: Overview; Residents & admissions (residents, applications); Accommodation (rooms, allocations, bookings); Finance (payments, receipts, refunds, reports-finance); Operations (maintenance, internet); Communications (announcements, messages); Administration & config (staff, setup, audit logs, settings). Bookings sit with accommodation because the agreement is the booking row. Reports can stay under Finance for the finance report and under Overview as a link; do not invent a second reports product.

### Resident routes

File: `resident-frontend/src/routes/AppRoutes.tsx`. `ProtectedRoute` checks a session only.

| Path | Who | Page |
|---|---|---|
| `/`, `/login`, `/register`, `/verify-otp` | public | redirect, login, register, OTP |
| `/home` | any signed-in resident | `HomePage` |
| `/profile` | same | `ProfilePage` |
| `/documents` | same | `DocumentsPage` |
| `/application` | same | `ApplicationPage` |
| `/booking` | same | `BookingPage` |
| `/payments` | same | `PaymentsPage` |
| `/room` | same | `RoomPage` |
| `/maintenance` | same | `MaintenancePage` |
| `/messages` | same | `MessagesPage` |
| `/announcements` | same | `AnnouncementsPage` |

Nav source: `resident-frontend/src/components/layout/navigation.ts`. Primary: Home, Application, Payments, My Room. More: Booking, Maintenance, Messages, Announcements, Profile, Documents. Nothing is removed for applicants.

### Public site

`www/index.html` plus `www/styles.css` and `www/assets/logo.*`. No router, no Apply Now, no enquiry form, no query handoff into the portal.

### Admin components worth reusing

| Piece | Path | Gap |
|---|---|---|
| Shell, sidebar, top bar | `components/layout/*` | Bell is decorative. Sidebar is not collapsible |
| `StatCard`, `StatusBadge`, `DataTable`, `EmptyState`, `LoadingState`, `ErrorState`, `ConfirmDialog` | `components/common/*` | No button, field, pagination, drawer, or sticky footer. `ConfirmDialog` scrolls as one block |
| `FinancePanel`, `OccupancyPanel`, `ConnectorStatusCard` | `components/dashboard`, `components/internet` | Not linked to records |
| Application modal pieces | `pages/Applications/*` | Closest match to the reference modal; layout and footer do not match it |
| Per-page dialogs | `pages/**/*Dialog.tsx` | About 24, not shared |

List pages that show **page-local** counts (must not be used as command-centre numbers): Applications, Residents, Bookings, Allocations (mixed), Payments, Receipts, Messages, Staff. Maintenance, Internet, Announcements, and Refunds already call report endpoints for at least some cards. Rooms load the full room list and filter it in the browser.

### Backend surface

Mounted from `cloudflare/src/index.ts`: `/health`, public, auth, `/admin`, `/resident`, `/connector`, `/staging`.

Staff lists (`GET`, paginated `limit`/`offset`/`search` only): academic sessions, institutions, rooms, room rates, lease periods, rate cards, roles, residents, applications, bookings, allocations, payments, receipts. Search is `LIKE` on a fixed column list. For applications that list includes `status`, so the search box is not a status filter.

Dashboard and reports (global aggregates unless noted):

| Method and path | Function | Notes |
|---|---|---|
| `GET /admin/dashboard`, `/admin/dashboard/overview` | `dashboard` | Residents, beds, occupancy, submitted-as-pending, bookings, maintenance. Not session-scoped |
| `GET /admin/dashboard/occupancy` | `occupancyReport` | Optional `academicSessionId` |
| `GET /admin/dashboard/finance` | `financialReport` | Sums and booking paid/unpaid counts. Pending payments are a **sum**, not a count of payments to verify |
| `GET /admin/dashboard/applications` | `applicationBookingReport` | Includes drafts. Optional session id. Dashboard UI ignores drafts |
| `GET /admin/dashboard/maintenance` | `maintenanceReport` | |
| `GET /admin/dashboard/announcements` | `announcementReport` | |
| `GET /admin/internet-access/summary` | `InternetAccessService.summary` | Includes sync failures. Not on the dashboard |
| `GET /admin/reports/*` | `reportOverview` and siblings | Some reports `LIMIT` rows; do not drive cards from those rows |

Domain writes (representative, not every setup CRUD route):

| Area | Routes | Permission sketch |
|---|---|---|
| Applications | `POST /admin/applications`, `PATCH /admin/applications/:id/status` | `application:write` |
| Bookings / agreements | `POST /admin/bookings`, `POST /admin/bookings/from-rate-card`, agreement, renew, extend, payment-policy, `PATCH .../status` | `booking:write`, confirm needs `booking:confirm` |
| Allocations | `GET /admin/availability`, `POST /admin/allocations`, transfer, cross-room transfer, status | `allocation:read` / `allocation:write` |
| Payments | create, verify, reject, slip, `PATCH .../status` (refuses `refunded`), receipt | `payment:*`, `receipt:*` |
| Refunds | `POST /admin/payments/:id/refund`, approve, reject, cancel, payout, credit notes, `GET /admin/reports/refunds` | `refund:*`, `credit_note:read`, `report:finance` |
| Documents | list, verify, reject, content. Ghana Card content needs `document:ghana_card` | `document:*` |
| Maintenance | create, assign, start, resolve, close, cancel | `maintenance:*` |
| Announcements and messages | publish, expire, archive; preview, send, archive | `announcement:*`, `message:*` |
| Gender | `POST /admin/residents/:id/gender-correction`, `GET /admin/gender-placement-conflicts` | `resident:gender_correct`, `allocation:read` |
| Internet | summary, connector health/status, provision, enable, suspend, reset, disconnect, retry | `internet:read` / `internet:manage` |
| Audit | `GET /admin/audit-logs` | `audit:read` |
| Resident | register OTP, `/resident/me/*` profile, documents, applications (+ submit), bookings, payments, refunds, credit notes, receipts, allocation, maintenance, announcements, messages, internet | resident session |
| Public | `GET /public/institutions`, `GET /public/announcements` | none |
| Staging | `POST /staging/otp-test/lookup` | staging env + key only |

There is no resident module-eligibility route, no enquiry route, and no resident application-cancel route.

### State machines

| Entity | States | Source |
|---|---|---|
| Application | `draft`, `submitted`, `under_review`, `approved`, `rejected`, `cancelled`, `archived` | `admin.service.ts` `updateApplicationStatus`; resident submit is the validated `draft → submitted` |
| Resident | `prospect`, `applicant`, `resident`, `past_resident`, `suspended`, `archived` | CHECK on `residents`. Runtime only writes `applicant` (self-register) or the admin-create initial value |
| Booking | `pending`, `confirmed`, `cancelled`, `expired`, `completed`, `archived` | `updateBookingStatus`. Confirm checks gender and payment threshold |
| Payment | `pending`, `submitted`, `verified`, `rejected`, `refunded`, `cancelled`, `archived` | `updatePaymentStatus`. `refunded` is not a client transition |
| Refund | `requested`, `approved`, `rejected`, `cancelled`, `paid` | `RefundService` + 0022 triggers. Approver ≠ requester |
| Allocation | `active`, `ended`, `cancelled`, `transferred`, `archived` | From `active` only, except transfers write `transferred` |
| Maintenance | `open`, `assigned`, `in_progress`, `resolved`, `closed`, `cancelled`, `archived` | `updateMaintenanceStatus` |
| Announcement | `draft`, `published`, `expired`, `archived` | |
| Message | `draft`, `queued`, `sent`, `partially_failed`, `failed`, `archived` | |
| Internet account | `active`, `suspended`, `disabled` plus sync `pending`, `synced`, `failed` | migration 0012 |
| Portal delivery | `unread`, `read` | `portal_message_deliveries` |

Agreement is not a table. It is the booking row after 0015/0018 (`lease_kind`, dates, `maintenance_fee_minor`, priced room, payment policy).

Duplicate active applications: partial unique indexes in `0016_resident_kind_and_application_flexibility.sql` on `(resident_id, academic_session_id)` where the lease period is null, and on `(resident_id, lease_period_id)` otherwise, for statuses `draft`, `submitted`, `under_review`, `approved`. Resident create also selects for an existing non-terminal row. Rejected, cancelled, and archived do not occupy the slot.

One active allocation per bed and per resident: indexes from migration 0019. Gender conflicts: `GET /admin/gender-placement-conflicts` and audit `admin.resident.gender_placement_conflict`. Physical double-booking is rejected in `validateAllocation`.

### Notifications versus audit

| Store | Role |
|---|---|
| `audit_logs` | Security and staff audit. PII-limited metadata. Admin screen for `audit:read`. **Not** a notification feed |
| `messages` + `portal_message_deliveries` | Outbound staff messages. Resident inbox is unread/read. Not an operations task list |
| `announcements` + channels | Broadcasts. Public route and resident route |
| Domain events | Do not exist. Action names such as `resident.application.submitted` are audit rows only |

AUX-17 adds a task table. Writers must be the transition that made the work real (submit, payment submitted, refund requested, maintenance opened, sync failed), and a later transition must complete the same deduped row. Do not tail `audit_logs`.

### Schema (migrations 0001–0022)

| Migration | Adds |
|---|---|
| 0001 | Canonical schema: identity, rooms, beds, applications, bookings, allocations, payments, receipts, documents, maintenance, announcements, sessions, `audit_logs` |
| 0002–0004 | Username, resident codes, booking numbers |
| 0005 | Payment and receipt sequences, `payment_attention_*` |
| 0006 | Onboarding columns, application numbers |
| 0007 | Maintenance numbers and timestamps |
| 0008 | `bookings.priced_room_id` |
| 0009 | Announcement delivery |
| 0010 | Messages and portal deliveries |
| 0011 | `system_settings` |
| 0012 | `resident_internet_accounts` |
| 0013–0014 | Lease periods, rate cards |
| 0015 | Agreement money on `bookings`, including `maintenance_fee_minor` |
| 0016 | Resident kind; applications rebuilt (nullable session, lease period, one-active indexes) |
| 0017 | Ghana Card number |
| 0018 | Bookings rebuilt (session optional) |
| 0019 | Allocations rebuilt (one active bed, one active resident) |
| 0020 | `connector_heartbeats` |
| 0021 | Staff password rotation, `auth_rate_limits` |
| 0022 | `refunds`, `credit_notes`, payment refund columns, guard triggers |

No `notifications` table. No `room_type` column. No check-in table.

### Tests already on `main` (do not treat as acceptance for this programme)

Worker: `cloudflare/src/**/*.test.ts`, `cloudflare/tests/**/*.test.ts`. Relevant files include `resident.service.test.ts`, `resident-kind.service.test.ts`, `workflow.service.test.ts`, `refund-integrity.test.ts`, `refund-milestone-2.test.ts`, `refund-records-0022.test.ts`, `gender-restricted-allocation.test.ts`, `resident-gender-correction.test.ts`, `agreement-aware-allocations-0019.test.ts`, `integration-e2e-2026-11-22.test.ts`, `stage-2l-l-completion.audit.test.ts`.

Admin and resident: Vitest + Testing Library, colocated `*.test.tsx`. No Playwright project. Capture script: `resident-frontend/scripts/ui-qa-screenshots.mjs` (Puppeteer, not declared in `package.json`).

---

## Requirement-to-implementation map

| ID | Already true on `main` | Build next | Do not redo |
|---|---|---|---|
| AUX-13 | Two teal systems and a separate marketing palette | P1.1 after D6 | A new logo |
| AUX-14 | Status badge, stat card, data table, empty/loading/error, confirm shell | P1.2, P1.3 | A component library package, unless later requested |
| AUX-15 | Overview, occupancy, finance sums, application counts, maintenance counts, connector card | P2.3 | Page-length counts presented as hostel totals |
| AUX-16 | Server search and offset | P2.2 then card links in P2.3 | Filtering 25 rows in the browser and calling it the queue |
| AUX-17 | Audit log, messages, announcements | P2.4, migration 0023, after D7 and D8 | Projecting `audit_logs` into the bell |
| AUX-18 | Nothing | P2.5 | — |
| AUX-19 | Server transition maps and explicit buttons | P3.6 | A frontend-only state machine, or buttons that confirm/allocate/refund by themselves |
| AUX-20 | Detail modals, `listRoomBeds` | P3.3–P3.5 with aggregate reads | Per-row fetches in a loop |
| AUX-21 | Application modal, download, archive, create agreement | P3.1, P3.2 | A second application write API |
| AUX-22 | Role-filtered sidebar, mobile overlay | P2.1, URL state in P2.2 | Hiding a nav item while the URL still returns the data to a role that must not see it |
| AUX-23 | Institutions and announcements are public | P5.1 after D4 | Linking Apply Now at a room id or bed id |
| AUX-24 | OTP registration, documents, lease-term application, no bed picker | P5.2, D9 | Room or bed selection for applicants |
| AUX-25 | Distinct draft insert and submit update | P4.1 and the draft card in P2.3 | A sync job that rewrites status |
| AUX-26 | One active application per period | P4.2 after D5 | Dropping the unique indexes |
| AUX-27 | Reject notes; new number sequence; money is not tied to a rejected application | P4.2, P4.3 | Deleting documents or payments on reject |
| AUX-28 | Staff cancel from draft/submitted | P4.4 after D2 | Building withdrawal on a guess |
| AUX-29 | Server-side maintenance and internet gates; journey copy on Home | P5.3, P5.4 | CSS-only hiding |
| AUX-30 | Allocation-after-confirm rule; historical payment queries | P5.5 after D3 | Setting `resident` in the client, or adding check-in without D3-C |
| AUX-31 | Partial refunds, maker/checker, payout uniqueness, credit notes, attention flag, archive guards, gender fail-closed, conflict list, overlap indexes | P6.1 records the D1 answer in tests | A silent change to refundable amount |

---

## Screen inventory and capture gaps

Current tool: `resident-frontend/scripts/ui-qa-screenshots.mjs`.

- Starts `vite preview` on port 4177, writes `localStorage` token `ui-qa-token`, and stubs resident JSON. It does not log in, does not complete OTP, and does not hit the Worker.
- Captures application, payments, room, booking, maintenance, messages, announcements, profile, documents at 1440, 430, and some 1024 widths.
- Does not capture `/home`, `/login`, `/register`, `/verify-otp`, any admin route, any modal or drawer, or a message/announcement detail.
- `puppeteer-core` is imported and is not a declared dependency. There is no npm script.
- Older PNGs under `docs/ui-qa/` (home, login background, portal consistency) are historical artifacts. Several `qa-notes.json` paths still mention another checkout path. They are not evidence for this programme.
- Admin has no capture script. Playwright is only an optional Vitest peer in the lockfile.

`P6.2` should: declare the browser dependency, add an npm script, capture auth screens without following the redirect away, open the Application Details modal and at least one drawer, include the admin command centre, and keep mocked fixtures labeled as fixtures. Self-contained HTML styling (the capture page must load the built CSS, including sticky regions and both breakpoints) is part of that PR’s acceptance, not a reason to screenshot production.

---

## PR register

Update this table when a PR opens. One line per PR. Phase 0 is the PR that added this file.

| PR | Branch | Status | Requirement IDs | Migration | Link |
|---|---|---|---|---|---|
| P0 | `cursor/staging-review-phase-0-b442` | open (this document) | — | none | https://github.com/Stronga/kissmet-hostel-portal/pull/32 |
| P1.1 | | not started | AUX-13 | none | |
| P1.2 | | not started | AUX-14 | none | |
| P1.3 | | not started | AUX-14 | none | |
| P2.1 | | not started | AUX-22 | none | |
| P2.2 | | not started | AUX-16, AUX-22 | none | |
| P2.3 | | not started | AUX-15, AUX-16 | none | |
| P2.4 | | not started | AUX-17 | 0023 | |
| P2.5 | | not started | AUX-18 | none | |
| P3.1 | | not started | AUX-21 | none | |
| P3.2 | | not started | AUX-21 | none | |
| P3.3 | | not started | AUX-20 | none | |
| P3.4 | | not started | AUX-20 | none | |
| P3.5 | | not started | AUX-20 | none | |
| P3.6 | | not started | AUX-19 | none | |
| P4.1 | | not started | AUX-25 | none | |
| P4.2 | | blocked on D5 | AUX-26, AUX-27 | 0024 | |
| P4.3 | | not started | AUX-27 | none | |
| P4.4 | | blocked on D2 | AUX-28 | only if `withdrawn` | |
| P5.1 | | blocked on D4 | AUX-23 | 0025 only for D4-B | |
| P5.2 | | not started | AUX-24 | none | |
| P5.3 | | not started | AUX-29 | none | |
| P5.4 | | not started | AUX-29 | none | |
| P5.5 | | blocked on D3 | AUX-30 | none | |
| P6.1 | | blocked on D1 | AUX-31 | 0026 only for D1-B if needed | |
| P6.2 | | not started | §16 capture | none | |

## Tests and acceptance evidence

Append a row when a PR adds proof. Phase 0 has no runtime change, so there is no new test run.

| PR | ID | Evidence | Date | Result |
|---|---|---|---|---|
| P0 | — | Diff is `docs/STAGING_REVIEW_IMPLEMENTATION.md` only. No tests, no migrations, no deploy | 2026-11-27 | recorded |

Acceptance notes for later PRs (fill the table, do not treat this list as done):

- AUX-15 / AUX-16: a card count equals a SQL count for the labeled period, and the destination list is that same set, including past page 1.
- AUX-17: a submitted application creates one open task; moving it to `under_review` does not create a second; approve completes it; an `audit_logs` row alone does not.
- AUX-25: Start leaves `draft`; Submit with missing documents leaves `draft`; successful Submit returns `submitted` with `submitted_at` set; dashboard draft and submitted counts both move.
- AUX-26: a second active application for the same period returns the existing unique-index error.
- AUX-27: reject keeps the row; reapply inserts a new `application_number`; payments and bookings for any prior approved stay are untouched.
- AUX-31: the test named in P6.1 matches the confirmed D1 option and fails on the other option.
- Gender: a resident with null gender is absent from single-gender availability and rejected on allocate. A matching gender is accepted. Correction writes an audit row and can surface a placement conflict.

## Screenshots

Append captures here. Do not treat files already under `docs/ui-qa/` as evidence for AUX-13–AUX-31.

| Date | PR | Surface | Viewport | File | Notes |
|---|---|---|---|---|---|
| | | | | | |

## Known limitations

| Item | Limitation | Cleared by |
|---|---|---|
| K1 | `docs/IMPLEMENTATION_PLAN_NEXT.md` and `docs/STAGING_PLAN.md` disagree with merged #31 / migration 0022 | a later docs PR, not Phase 0 |
| K2 | “Active Residents” will not match occupied beds until D3 | P5.5 |
| K3 | Dashboard “Pending Applications” ignores drafts | P2.3 |
| K4 | List status filters do not survive pagination | P2.2 |
| K5 | Resident UI blocks reapply after reject/cancel | P4.3 |
| K6 | Maintenance fee is non-refundable in the obligation model and refundable in full at payment level | D1 then P6.1 |
| K7 | No check-in, no corrections status, no withdrawal, no room-type catalog, no enquiry, no staff task table | the decision and the PR named above |
| K8 | Capture script does not exercise auth, admin, or modals, and Puppeteer is undeclared | P6.2 |
| K9 | `www` is a coming-soon page with a third colour palette | P5.1 after D4 and D6 |
| K10 | Admin route table does not repeat sidebar role gates | P2.1 where a page would otherwise show forbidden data |

## Phase 0 non-actions

This phase did not implement Phases 1–6, did not add a migration, did not call Wrangler against a remote D1, did not deploy a Worker or Pages project, and did not change Cloudflare, the Pi connector, or MikroTik.
