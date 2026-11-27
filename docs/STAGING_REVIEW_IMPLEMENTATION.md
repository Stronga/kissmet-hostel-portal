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

## Decisions

D1–D10 were confirmed on 2026-11-27. The notes under each heading are the Phase 0 investigation. The recorded choice replaces the open question. Later phases implement these choices; this Phase 1 pull request does not.

| ID | Recorded choice |
|---|---|
| D1 | Protect the non-refundable maintenance fee once per booking where the agreed terms support it. Refundable balance is verified payments, minus the protected maintenance fee, minus previous finalized refunds, minus pending refund commitments. Concurrent requests must not exceed that balance. An authorized exception uses a separate audited process. Phase 6 updates the PR #31 maths and does not weaken maker/checker. |
| D2 | Add `withdrawn`, distinct from staff cancel and reject. An applicant may withdraw from `draft`, `submitted`, `under_review`, and `corrections_required` when no contractual or financial commitment prevents it. Management may cancel `under_review` with permission, a mandatory reason, and an audit row. History stays. Reapplication uses a new reference and may reuse a valid account and documents. Never auto-cancel a booking, delete a payment, or issue a refund. |
| D3 | On a qualifying room allocation, `residents.status` moves `applicant` → `resident`. It moves to `past_resident` when the final active allocation ends and no other active accommodation remains. Renewals, future-dated allocations, cancellations, and overlaps stay consistent. No mandatory physical check-in. Per-service eligibility stays independent. The change is transactional and auditable. |
| D4 | Room type is a catalog managed in Admin Setup. Fixtures in this programme are synthetic. Do not invent real Kissmet room types, capacities, or prices. Room type, accommodation term, gender policy, room, and bed stay distinct. Applicants choose a preferred room type and term only. Existing rows stay migration-compatible. |
| D5 | Add `corrections_required`. The resident resubmits on the same application reference. Management names the required information and documents. Review history stays. Resubmission creates a new actionable management task. Unrelated fields cannot be edited. |
| D6 | Do not use the old resident teal as the default primary. Primary green `#064B36`, dark green `#142526`, gold `#B9A17A` and orange `#F58220` as sparse accents, semantic red `#CE071B`, background `#F5F7F6`. Derived text and border colours exist only where a brand hex fails WCAG AA in that role. The logo artwork is unchanged. |
| D7 | Persistent `staff_tasks`, separate from `audit_logs`. Super Admin and Manager see all authorized operations. Reception: applications, enquiries, bookings, allocations. Accounts: payments, receipts, refunds. Maintenance: maintenance requests. Internet provisioning failures: Manager and Super Admin. Reconcile with RBAC. Visibility does not grant extra action permissions. Maker/checker stays. Unread is distinct from unresolved. Deduplicate, sync across admins, and deep-link to the exact record. |
| D8 | A public accommodation enquiry form feeds the Admin activity centre and does not require an account. Review, response, and resolution are tracked. Validate input, rate-limit, and protect against spam, with privacy safeguards. No unapproved live SMS or email. |
| D9 | Collect accommodation-related gender during profile completion, before application submission, not at initial registration. Gender-restricted allocation stays fail-closed. Provide a staff-assisted route when the standard options do not fit. |
| D10 | The dashboard defaults to all periods. An academic session or lease period filters only when someone selects it, and the label states that scope. Counts and filters use the complete authorized dataset, not the current page of 25. |
| Draft vs Submitted | Keep both states. The UI must distinguish starting an application from submitting it, explain incomplete requirements, and link to them. Drafts are excluded from pending-review counts and shown separately where that is useful. |

The subsections below are the investigation those choices were made against.

### D1. Maintenance fee on refunds — recorded; implement in Phase 6

**Recorded choice:** protect the fee (the D1-B direction), calculated from the booking’s agreed maintenance fee rather than by reversing maker/checker. A new column is migration 0026 only if the fee cannot be read from the booking.

Section 14 asks for non-refundable maintenance-fee protection. On `main`:

- Migration 0015 defines `bookings.maintenance_fee_minor` as a non-refundable snapshot. `agreement-financial.ts` adds it to the **obligation** (what the resident must pay) and does not add it to verified payments.
- Refund milestone 2 (PR #31, merged) sets the refundable remainder to `payment.amount_minor − paid refunds − open refunds`. The 0022 trigger `refunds_within_payment_amount` uses the same ceiling. The fee is not subtracted.
- `docs/IMPLEMENTATION_PLAN_NEXT.md` records why: the fee is not attributed to a particular payment, so milestone 2 did not deduct it. That was the choice taken on the branch that became #31.

**Confirm one:**

- **D1-A (current `main`):** leave refund maths unchanged. The fee stays non-refundable only as an obligation concept. A verified payment can still be refunded in full.
- **D1-B:** reserve the fee. A booking’s payments may be refunded only down to `maintenance_fee_minor` (or another rule you specify). This changes `RefundService.refundable` and needs tests against partial payments. A new column is migration 0026 only if the fee must be stored on the payment rather than read from the booking.

Phases 1–5 do not change refund amounts.

### D2. Applicant self-withdrawal — recorded; `withdrawn` folds into migration 0024

**Recorded choice:** new `withdrawn` status, applicant withdrawal from `draft`, `submitted`, `under_review`, and `corrections_required` when nothing contractual or financial prevents it, and a permissioned management cancel of `under_review` with reason and audit. No automatic booking cancel, payment delete, or refund.

There is no resident withdraw endpoint. Staff `PATCH /admin/applications/:id/status` may set `cancelled` only from `draft` or `submitted`. `under_review` can only go to `approved` or `rejected`.

**Confirm:**

- May an applicant withdraw, and from which statuses (`draft` only, or also `submitted` / `under_review`)?
- Is the stored status `cancelled` with actor = resident, or a new `withdrawn` value (that forces a table rebuild)?
- May staff cancel an application that is already `under_review`?
- Withdrawal must not delete payments, bookings, or refunds. None of those exist before approval today (a booking requires `approved`).

### D3. When someone becomes an active resident — recorded (D3-A, plus the overlap rules below)

**Recorded choice:** promote on qualifying allocation and set `past_resident` when the last active allocation ends. No new check-in step. The `residents.status` column already exists, so P5.5 does not need a migration.

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

### D4. What “room type” means — recorded (D4-B, synthetic catalog only)

**Recorded choice:** a setup-managed catalog, migration 0025, distinct from term, gender policy, room, and bed. Applicants pick preferred type and term only. Do not seed real Kissmet types, capacities, or prices.

Applications have `lease_kind` and `lease_period_id` only. Rooms have `capacity` and `gender_policy`, not a type code. Residents already cannot choose a room or a bed. My Room labels gender policy as “Room type”.

**Confirm:**

- **D4-A:** “room type” in the brief means Requested Term (Academic Calendar, Calendar Year, Short-Term). Apply Now passes that term. No migration.
- **D4-B:** it means a new catalog (for example shared room vs private room) that is not gender and not the lease term. That is migration 0025 and a public-site selector. It is still not a room or bed id.
- **D4-C:** it means gender occupancy. That conflicts with fail-closed gender allocation (D9) and with the current label bug. Not recommended unless you explicitly want applicants to choose a gendered room class.

### D5. Corrections loop — recorded (D5-A)

**Recorded choice:** `corrections_required` on the same application reference, with history kept and a new management task on resubmission. Shares the applications CHECK rebuild in migration 0024 with D2.

After submit, the resident cannot edit the application. Staff cannot send it back. Rejected identity documents can be re-uploaded, but that does not reopen the application. `submitted` may move to `under_review` or `cancelled` only.

**Confirm:**

- **D5-A:** add `corrections_required` (migration 0024 rebuilds the `applications` CHECK), with a defined return path to `submitted`, who may request corrections, and whether documents must be re-checked.
- **D5-B:** no in-place correction. Staff reject; the resident reapply flow (AUX-27) starts a new reference. Smaller, but it is not a correction workflow.

### D6. Shared colour primary — recorded; shipped in Phase 1

**Recorded choice:** the official green / dark / gold / orange / red / background palette below, not the resident teal proposed as D6-A during Phase 0. Gold and orange are sparse accents and are not body text on light surfaces. Phase 1 locked the tokens after contrast checks.

Shipped values:

| Surface | Primary | Other |
|---|---|---|
| Admin (`admin-frontend/src/styles/index.css`) | `#1f6f78` | success `#138a55`, warning `#a86405`, danger `#c2413a` |
| Resident | `#056268` | accent gold `#d99f35`, success `#127b55`, warning `#c7691a`, danger `#c2413a` |
| `www` coming-soon | — | gold `#b8860b`, red `#c62828`, green `#2e7d32` |
| Logo ident | forest green laurels, gold/beige ring, red marks, black star, orange and green swooshes | not sampled into hex in this phase |

**Confirm D6-A as the Phase 1 default unless you say otherwise:** one operational teal taken from the resident primary (`#056268`), gold used only as a sparse accent, red only for destructive and failed states, admin and resident neutrals reconciled. Do not repaint the portals with the coming-soon gold/red/green set, and do not use the colours in the proposed-screen mock. The logo artwork is unchanged.

### D7. Who sees which action-centre items — recorded; still Phase 2

**Recorded choice:** `staff_tasks` as its own table. Role visibility matches the matrix below, reconciled with RBAC, and never grants the action permission by itself. Unread and unresolved stay separate. Internet provisioning failures are Manager and Super Admin. Reception includes enquiries once D8 exists.

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

### D8. Public enquiries — recorded; in scope for the activity centre

**Recorded choice:** a public form with no account, tracked through review, response, and resolution, with validation, rate limiting, spam protection, and privacy safeguards. No unapproved live SMS or email. If the enquiry cannot be a `staff_tasks` row alone, its table is migration 0027 rather than a renumber of 0023–0026.

The public site has no form, and there is no enquiry table. **Confirm** whether this programme includes a public enquiry that creates an action-centre task, or whether enquiries stay out of scope until the public site is redesigned on its own.

### D9. Gender collection — recorded

**Recorded choice:** collect accommodation-related gender during profile completion, before submit, not on the registration form. Fail-closed single-gender allocation stays. The existing audited staff gender-correction route covers cases the standard options do not fit.

Single-gender rooms accept only `female` or `male`. `NULL`, `other`, and `not_specified` are refused (`gender-eligibility.ts`). Registration and profile do not collect gender. An applicant can be approved and then be unblockable for every single-gender room until a staff member with `resident:gender_correct` records a gender (audited, with conflict acknowledgement).

**Confirm:** require `female` or `male` at registration, or keep gender staff-entered. The fail-closed allocation rule itself should stay.

### D10. Dashboard period label — recorded (D10-A)

**Recorded choice:** default copy and queries are all periods. A session or lease-period filter applies only when selected, and the label says so. Counts are global for the authorized set, never the current page of 25.

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

**Recorded choice:** keep `draft` and `submitted` as intentional states. The UI must separate starting an application from submitting it, explain what is still incomplete, and link to those requirements. Pending-review counts exclude drafts. Show drafts separately where that helps.

If a live staging row still disagrees with this finding, capture before any code change: application id, `status`, `submitted_at`, `updated_at`, and the audit actions `resident.application.created` and `resident.application.submitted` (or `admin.application.submitted`). Those two actions are the proof of which request ran.

---

## Phase 0–6 plan

Each row is one pull request, branched from `main` unless a note says it stacks. Phase 0 is this document. Phases 1–6 are not started here.

Migrations, when required, are the next numbers after 0022. `main` is still at `0022_refund_records_credit_notes.sql`. Do not edit 0001–0022. Do not apply migrations to staging or production from these PRs; application stays a reviewed operator step.

Reserved after the confirmed decisions, still not created by Phase 1:

| Number | Use |
|---|---|
| 0023 | `staff_tasks` (D7). Public enquiries land here if a task row is enough |
| 0024 | Application CHECK rebuild: `corrections_required`, `withdrawn`, and cancel actor/reason metadata (D2, D5) |
| 0025 | Room-type catalog (D4). Synthetic fixtures only |
| 0026 | Only if the D1 refund rule cannot be read from `bookings.maintenance_fee_minor` |
| 0027 | Public enquiry storage only if it does not fit 0023 |

Phase 1 was approved as one pull request for tokens, the shared component source, and the admin and resident shells (including the AUX-22 group names and a collapsible sidebar). It does not include P2.2 URL state, route-level permission blocks, or any Phase 2–6 behaviour.

| PR | Phase | IDs | Delivers | Migration |
|---|---|---|---|---|
| P0 | 0 | — | This tracker | none |
| P1 | 1 | AUX-13, AUX-14, AUX-22 shell | One PR: confirmed D6 tokens, unmodified logo ident, shared components under `admin-frontend/src/design-system` imported by both portals, collapsible admin groups, resident shell on the same tokens. Not the Application Details layout (that stays P3.1) | none |
| P1.1–P1.3 | 1 | AUX-13, AUX-14 | Combined into P1 after the Phase 1 scope was approved as a single pull request | none |
| P2.1 | 2 | AUX-22 | Group names and the collapsible shell shipped in P1. This PR still adds route-level blocks only where a page currently renders data the role must not see | none |
| P2.2 | 2 | AUX-16, AUX-22 | Server-side status (and session/period) filters on the list endpoints that cards will open. Persist filter, search, and offset in the URL. `pagination.total` on those lists. Remove client-side filtering of a single page | none |
| P2.3 | 2 | AUX-15, AUX-16 | Dashboard counts that SQL can already express, each labeled with its period (D10). Cards link to the filtered URL from P2.2. Retire “On Page” totals. Add: drafts, payments awaiting verification (count, not only sum), refunds in `requested`, confirmed bookings with no active allocation, approved applications with no booking, internet `sync_status = failed`. Do not invent a corrections count before D5 | none |
| P2.4 | 2 | AUX-17 | `staff_tasks` written by existing transitions. Dedupe key. Completion derived from the subject’s real status. Permission rules from D7. No insert from generic audit logging. Public enquiries are in scope (D8); use 0027 only if they need their own table | **0023** |
| P2.5 | 2 | AUX-18 | Dashboard panel: Action required, All activity, Completed. Unread vs unresolved. Pagination. Deep link to the record route or modal. Bell shows unread count for that role | none |
| P3.1 | 3 | AUX-21 | Application Details layout from the reference: identity header, status badge, applicant and accommodation columns, documents with the existing download, review and agreement columns, sticky Archive / Close / Create Agreement. Actions still call the current endpoints | none |
| P3.2 | 3 | AUX-21 | Same modal shell for booking and payment detail. A dedicated page only where the action centre must link to a URL that survives refresh | none |
| P3.3 | 3 | AUX-20 | Rooms → beds and current occupants from one aggregate read, not one request per row. Keyboard row toggle. Usable at 430px | none |
| P3.4 | 3 | AUX-20 | Nested rows for residents, applications, and bookings, same aggregate rule | none |
| P3.5 | 3 | AUX-20 | Nested rows for payments (receipts, refunds), maintenance, and internet accounts | none |
| P3.6 | 3 | AUX-19 | Read-only stage strip fed by the backend transition and by blockers the API already returns (incomplete application, gender, payment threshold). Primary button performs the existing explicit action. No auto-confirm, auto-allocate, auto-approve, or auto-refund | none |
| P4.1 | 4 | AUX-25 | Draft vs submit copy, disabled reason, dashboard draft count. No change to the two HTTP calls | none |
| P4.2 | 4 | AUX-26, AUX-27 | D5 and D2 are recorded. Status rebuild for `corrections_required` and `withdrawn`, cancel actor, time, and resident-facing explanation. Resubmit keeps the reference. Reapply uses a new number. Do not cascade-delete money or bookings | **0024** |
| P4.3 | 4 | AUX-27 | Resident history for rejected and cancelled rows; Start application when the API would accept a new period application. Reuse profile and unrejected documents | none |
| P4.4 | 4 | AUX-28 | Resident withdrawal endpoint and UI for the recorded `withdrawn` rules. Fold the status into 0024 before that migration ships; this PR has no migration of its own if 0024 already contains `withdrawn` | none if 0024 already shipped the status |
| P5.1 | 5 | AUX-23 | Public page: real Apply Now into the resident register/login, carrying the preferred room type and term. Coming-soon shell can stay until copy exists. Catalog fixtures are synthetic | **0025** |
| P5.2 | 5 | AUX-24 | Registration and profile copy. No room or bed picker. Gender is collected on profile completion, before submit, per D9 | none |
| P5.3 | 5 | AUX-29 | `GET /resident/me/portal-access` (name flexible) computed from application, booking, and allocation. Server routes that already 403/400 stay the enforcement; the payload is not a second permission system | none |
| P5.4 | 5 | AUX-29 | Resident nav and announcement queries follow that payload. Applicant does not get maintenance or internet actions. Approved applicant gets booking and payments when a booking exists or the application is approved. Active resident modules follow D3 | none |
| P5.5 | 5 | AUX-30 | D3-A is recorded. Set `residents.status` in the allocation and allocation-end transactions, including renewals, future dates, cancellations, and overlaps, and fix the dashboard definition in the same PR. No check-in step | none (column exists) |
| P6.1 | 6 | AUX-31 | D1 is recorded as fee protection. Change `refundable` and the tests so the balance is verified payments minus the protected fee, finalized refunds, and pending commitments. Keep maker/checker. Do not keep the old full-refund behaviour | **0026 only if a column is required** |
| P6.2 | 6 | §16 | Screen inventory and capture-tool update. See [Capture gaps](#screen-inventory-and-capture-gaps) | none |

Suggested merge order: P0 (merged), then P1, then P2.1 and P2.2 (P2.3 depends on P2.2), then P2.4 → P2.5, then P3.x, then P4.1 (can be earlier; it does not need the new modal), then P4.2 → P4.3 → P4.4, then P5, then P6. P6.1 can proceed now that D1 is recorded; it does not depend on the redesign.

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
| AUX-13 | Two teal systems and a separate marketing palette | P1 (open) uses the confirmed D6 palette | A recoloured logo |
| AUX-14 | Status badge, stat card, data table, empty/loading/error, confirm shell | P1 (open) adds the shared primitives. Page adoption of the new modal layout is still P3 | A second copy of the primitives |
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

## Phase 1 component inventory

Single source: `admin-frontend/src/design-system`. The resident app imports it. There is no second copy.

| Piece | Module |
|---|---|
| Tokens and contrast pairs | `tokens.css`, `tokens.ts`, `contrast.ts` |
| Component CSS | `components.css` |
| Logo | `assets/kissmet-logo-ident.png` (byte-identical to the supplied ident, 791×541) |
| Brand mark | `react/BrandMark.tsx` — height is set, width is automatic |
| Button | primary, secondary, ghost, danger, icon, loading, disabled |
| Fields | text, textarea, select, hint, error |
| Search | `SearchFilterBar` |
| Status | `StatusBadge` tones success, warning, danger, info, neutral |
| Summary card | static, link, and button |
| Table | `DataTable` one-level expand, `aria-expanded`, Enter/Space, arrow keys, stacked under 640px |
| Pagination | previous / next, disabled at the ends |
| Modal | sticky header and footer, focus trap, Escape, confirm variant |
| Drawer | left or right, focus trap, Escape |
| Workflow | `WorkflowSteps` |
| Activity | `ActivityItem` with separate unread and unresolved flags |
| States | empty, spinner, skeleton, error |
| Notices | `Banner`, `Toast` |
| Navigation | `NavShell` collapsible groups and icon rail |

Admin shell groups: Overview, Residents & Admissions, Accommodation, Finance, Operations, Communications, Administration & Configuration. Existing role arrays on each item are unchanged. Resident primary and More navigation, including the bottom bar, are unchanged. Existing `ConfirmDialog` now uses the modal shell but hides the extra close control so page actions named Close stay unique. `design-preview.html` is a local Vite page and is not part of the production Rollup input.

### Contrast (WCAG AA)

Approved pairs are asserted in `contrast.test.ts`. Measured ratios, rounded:

| Pair | Ratio | Bar |
|---|---|---|
| `#064B36` on white / white on `#064B36` | 10.16 | 4.5 text |
| White on primary hover `#043828` | 13.11 | 4.5 |
| `#142526` on white / on `#F5F7F6` | 15.88 / 14.76 | 4.5 |
| Secondary `#3E524C` on white / `#F5F7F6` / muted `#E7EEEB` | 8.35 / 7.76 / 7.09 | 4.5 |
| `#CE071B` on white / on `#FDECEE` | 5.72 / 5.02 | 4.5 |
| White on danger hover `#A30616` | 8.09 | 4.5 |
| `#064B36` on success surface `#E5F3EC` | 8.88 | 4.5 |
| Warning text `#9A4A00` on white / on `#FFF4E6` | 6.26 / 5.77 | 4.5 |
| Info `#0C4A6E` on white / on `#E7F2F8` | 9.46 / 8.31 | 4.5 |
| `#142526` on orange `#F58220` | 6.12 | 4.5 |
| Gold `#B9A17A` on `#142526` | 6.38 | 4.5 |
| Gold on `#064B36` | 4.08 | 3.0 large or non-text only; under 4.5 so not body text |
| Border `#6A8178` on white / on `#F5F7F6` | 4.18 / 3.88 | 3.0 UI |
| Focus `#064B36` on `#F5F7F6` | 9.44 | 3.0 |

Not used as text or as the only boundary on light surfaces: gold on white 2.49, gold on `#F5F7F6` 2.31, orange on white 2.59, orange on `#F5F7F6` 2.41. Disabled controls use reduced opacity and are not claimed as AA text.

### Accessibility checks in Phase 1

- Global `:focus-visible` ring uses the primary green with a 2px offset so it sits on the page background.
- Modal and drawer expose `role="dialog"` and `aria-modal="true"`, label themselves from the title, move focus inside on open, cycle Tab, close on Escape, and return focus to the opener. Covered by component tests.
- Expand controls expose `aria-expanded` and `aria-controls`. Enter, Space, Arrow Up, and Arrow Down are tested.
- Nav groups use `aria-expanded` and `aria-controls`. Collapsing the admin rail uses `aria-pressed`. Reception still cannot see Payments, Internet Access, or Staff.
- Preview page is not linked from either portal navigation.

## PR register

Update this table when a PR opens. One line per PR. Phase 0 is the PR that added this file.

| PR | Branch | Status | Requirement IDs | Migration | Link |
|---|---|---|---|---|---|
| P0 | `cursor/staging-review-phase-0-b442` | merged | — | none | https://github.com/Stronga/kissmet-hostel-portal/pull/32 |
| P1 | `cursor/phase1-design-foundation-5ab8` | open | AUX-13, AUX-14, AUX-22 shell | none | https://github.com/Stronga/kissmet-hostel-portal/pull/33 |
| P1.1–P1.3 | — | combined into P1 | AUX-13, AUX-14 | none | |
| P2.1–P2.5, workflow read model | `cursor/phase-2-admin-command-centre-b147` | opened | AUX-15, AUX-16, AUX-17, AUX-18, AUX-19 read model, AUX-22 route gates | **0023** | Phase 2 pull request (not merged, not applied remotely) |
| P3.1 | | not started | AUX-21 | none | |
| P3.2 | | not started | AUX-21 | none | |
| P3.3 | | not started | AUX-20 | none | |
| P3.4 | | not started | AUX-20 | none | |
| P3.5 | | not started | AUX-20 | none | |
| P3.6 | | read model opened with Phase 2; modal layout stays P3 | AUX-19 | none | |
| P4.1 | | not started | AUX-25 | none | |
| P4.2 | | not started (D5 and D2 recorded) | AUX-26, AUX-27 | 0024 | |
| P4.3 | | not started | AUX-27 | none | |
| P4.4 | | not started (D2 recorded; status belongs in 0024) | AUX-28 | none if 0024 has `withdrawn` | |
| P5.1 | | not started (D4 recorded) | AUX-23 | 0025 | |
| P5.2 | | not started | AUX-24 | none | |
| P5.3 | | not started | AUX-29 | none | |
| P5.4 | | not started | AUX-29 | none | |
| P5.5 | | not started (D3-A recorded) | AUX-30 | none | |
| P6.1 | | not started (D1 recorded) | AUX-31 | 0026 only if a column is required | |
| P6.2 | | not started | §16 capture | none | |

## Tests and acceptance evidence

Append a row when a PR adds proof. Phase 0 has no runtime change, so there is no new test run.

| PR | ID | Evidence | Date | Result |
|---|---|---|---|---|
| P0 | — | Diff is `docs/STAGING_REVIEW_IMPLEMENTATION.md` only. No tests, no migrations, no deploy | 2026-11-27 | recorded |
| P1 | AUX-13 | `admin-frontend` vitest `src/design-system/contrast.test.ts`: every approved pair meets its AA minimum; gold and orange on white and on `#F5F7F6` stay under 3:1 | 2026-11-27 | passed |
| P1 | AUX-14, AUX-22 shell | `admin-frontend` vitest: expandable table keyboard, modal and drawer focus trap and Escape, status tones, nav group collapse, pagination, sidebar groups and reception role limits. 32 files, 267 tests | 2026-11-27 | passed |
| P1 | — | `resident-frontend` vitest 24 files, 193 tests. `tsc --noEmit` / `tsc -p tsconfig.app.json` and `tsc -p tsconfig.node.json` passed in both frontends. `vite build` passed with `VITE_API_BASE_URL=https://api.example.com` (local check only; not a deploy) | 2026-11-27 | passed |

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
| 2026-11-27 | P1 before | Admin login | 1440×900 | `/opt/cursor/artifacts/phase1-before/before-admin-login-1440x900.png` | Local Vite, `main` before this branch |
| 2026-11-27 | P1 before | Admin login | 390×844 | `/opt/cursor/artifacts/phase1-before/before-admin-login-390x844.png` | |
| 2026-11-27 | P1 before | Admin dashboard | 1440×900 | `/opt/cursor/artifacts/phase1-before/before-admin-dashboard-1440x900.png` | Mocked local API, not staging |
| 2026-11-27 | P1 before | Admin dashboard | 390×844 | `/opt/cursor/artifacts/phase1-before/before-admin-dashboard-390x844.png` | |
| 2026-11-27 | P1 before | Resident login | 1440×900 | `/opt/cursor/artifacts/phase1-before/before-resident-login-1440x900.png` | |
| 2026-11-27 | P1 before | Resident login | 390×844 | `/opt/cursor/artifacts/phase1-before/before-resident-login-390x844.png` | |
| 2026-11-27 | P1 before | Resident home | 1440×900 | `/opt/cursor/artifacts/phase1-before/before-resident-home-1440x900.png` | Mocked local API |
| 2026-11-27 | P1 before | Resident home | 390×844 | `/opt/cursor/artifacts/phase1-before/before-resident-home-390x844.png` | Bottom nav still present |
| 2026-11-27 | P1 after | Admin login | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-admin-login-1440x900.png` | Official ident, primary green |
| 2026-11-27 | P1 after | Admin login | 390×844 | `/opt/cursor/artifacts/phase1-after/after-admin-login-390x844.png` | |
| 2026-11-27 | P1 after | Admin dashboard | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-admin-dashboard-1440x900.png` | New groups, collapsible sidebar |
| 2026-11-27 | P1 after | Admin dashboard | 390×844 | `/opt/cursor/artifacts/phase1-after/after-admin-dashboard-390x844.png` | Menu button kept |
| 2026-11-27 | P1 after | Resident login | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-resident-login-1440x900.png` | |
| 2026-11-27 | P1 after | Resident login | 390×844 | `/opt/cursor/artifacts/phase1-after/after-resident-login-390x844.png` | |
| 2026-11-27 | P1 after | Resident home | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-resident-home-1440x900.png` | Same routes, new mark and primary |
| 2026-11-27 | P1 after | Resident home | 390×844 | `/opt/cursor/artifacts/phase1-after/after-resident-home-390x844.png` | Bottom nav kept |
| 2026-11-27 | P1 after | Component preview | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-admin-showcase-1440x900.png` | Local `/design-preview.html`, not a product route |
| 2026-11-27 | P1 after | Component preview | 390×844 | `/opt/cursor/artifacts/phase1-after/after-admin-showcase-390x844.png` | |
| 2026-11-27 | P1 after | Sample modal | 1440×900 | `/opt/cursor/artifacts/phase1-after/after-admin-showcase-modal-1440x900.png` | Sticky header and footer, expanded sample row behind it |

## Known limitations

| Item | Limitation | Cleared by |
|---|---|---|
| K1 | `docs/IMPLEMENTATION_PLAN_NEXT.md` and `docs/STAGING_PLAN.md` disagree with merged #31 / migration 0022 | a later docs PR, not Phase 0 |
| K2 | “Active Residents” will not match occupied beds until D3 | P5.5 |
| K3 | Dashboard “Pending Applications” ignores drafts | Cleared in the Phase 2 command centre: drafts are a separate card and are excluded from awaiting review |
| K4 | List status filters do not survive pagination | Cleared for the queues the command centre opens: status, queue, session, and offset are in the URL and applied in SQL |
| K5 | Resident UI blocks reapply after reject/cancel | P4.3 |
| K6 | Maintenance fee is non-refundable in the obligation model and still refundable in full at payment level until P6.1 | D1 is recorded; P6.1 changes the maths |
| K7 | No check-in, no corrections status, no withdrawal, no room-type catalog, no public enquiry | Staff tasks are migration 0023. `corrections_required`, `withdrawn`, and the room-type catalog stay in later phases. Public enquiries (D8) are deferred |
| K8 | Capture script does not exercise auth, admin, or modals, and Puppeteer is undeclared | P6.2 |
| K9 | `www` is a coming-soon page with a third colour palette | P5.1 after D4 and D6 |
| K10 | Admin route table does not repeat sidebar role gates | Phase 2 gates finance, internet, announcements, messages, reports, staff, setup, audit, and settings on the same permissions as the API |

## Phase 0 non-actions

This phase did not implement Phases 1–6, did not add a migration, did not call Wrangler against a remote D1, did not deploy a Worker or Pages project, and did not change Cloudflare, the Pi connector, or MikroTik.

## Phase 1 non-actions

Phase 1 did not add a migration, did not change refund maths, application status, resident status, room types, enquiries, or `staff_tasks`, did not deploy, and did not change Cloudflare, the Pi connector, or MikroTik. The pull request was not merged from this work.

## Phase 2 — command centre, activity, and guided workflows

Local migration head after this pull request: `0023_staff_tasks.sql`. It is not applied to staging or production. 0001–0022 are unchanged.

### Migration 0023

| Table | Purpose |
|---|---|
| `staff_tasks` | One operational task per dedupe key. Status is `open`, `completed`, or `unavailable`. Not a copy of `audit_logs`. |
| `staff_task_reads` | Per-staff `read_at`. Reading a row never changes `staff_tasks.status`. |

Dedupe key examples: `application:{id}:review`, `application:{id}:agreement`, `booking:{id}:allocation`, `payment:{id}:verify`, `refund:{id}:approval`, `maintenance:{id}:work`, `internet:{id}:sync`. Upsert is `ON CONFLICT(dedupe_key)`.

### API

| Method | Path | Behaviour |
|---|---|---|
| GET | `/admin/dashboard/command-centre` | Global counts for the signed-in role. Default scope is all periods. `academicSessionId` or `leasePeriodId`, not both. |
| GET | `/admin/dashboard/occupancy/rooms` | Rooms, beds, and current occupants in one query. |
| GET | `/admin/activity` | `view=action_required\|all\|completed`, paginated. Reconciles existing open work first. |
| GET | `/admin/activity/unread-count` | Unread tasks for this staff member. |
| POST | `/admin/activity/:id/read` | Marks that staff member’s read time. Does not complete the task. |
| GET | `/admin/workflows/:subjectType/:id` | Stages, next action, responsible role, and blockers from the current row and the existing transition rules. |
| GET | `/admin/applications`, `/bookings`, `/allocations`, `/payments`, `/receipts`, `/maintenance`, `/refunds` | Server-side status, queue, session, or period filters. `pagination.total` is the filtered set, not the page. |

List links from the cards use those query parameters, including `record=<id>`, and the page opens that record.

### Visibility

Super Admin and Manager see every authorized category. Reception sees applications, bookings, and allocations. Accounts sees payments, receipts, and refunds. Maintenance sees maintenance requests. Internet provisioning failures are Manager and Super Admin. A task never grants the action permission. Refund approval still rejects the requester (`Refund approval by the requester is forbidden`).

Draft applications are counted and labeled separately. They are not review tasks.

### Deferred

| Item | Why |
|---|---|
| Public enquiries (D8) | No enquiry table and no public form in this PR. Reception’s enquiry category is reserved and empty. A later PR can add migration 0027 only if a task row is not enough. |
| `corrections_required`, `withdrawn` | Phase 4 / migration 0024. The workflow payload says they are not shown. No temporary status was added. |
| Room-type catalog | Phase 5 / migration 0025. |
| Active-resident status following allocation | Still `residents.status = 'resident'`. Occupancy is the active-allocation count. P5.5 changes the status. |
| Maintenance-fee refund protection | Phase 6. Maker/checker is unchanged. |

### Tests and checks (local only)

| Check | Result |
|---|---|
| `cloudflare` vitest | 41 files, 573 tests passed |
| `admin-frontend` vitest | 34 files, 275 tests passed |
| `resident-frontend` vitest | 24 files, 193 tests passed |
| `tsc --noEmit` in cloudflare, admin, and resident | passed |
| `vite build` with `VITE_API_BASE_URL=https://api.example.com` | passed for admin and resident. Not a deploy. |
| `npm audit` in cloudflare, admin-frontend, resident-frontend | 0 vulnerabilities |

### Screenshots

Local Vite preview (`admin-frontend/phase2-preview.html`) with fixture data. Not staging or production.

| Date | Surface | Viewport | File |
|---|---|---|---|
| 2026-11-27 | Admin dashboard, activity open | 1440×900 | `/opt/cursor/artifacts/phase2-dashboard-activity-open-1440x900.png` |
| 2026-11-27 | Admin dashboard, activity collapsed | 1440×900 | `/opt/cursor/artifacts/phase2-dashboard-activity-collapsed-1440x900.png` |
| 2026-11-27 | Admin dashboard and activity centre | 390×844 | `/opt/cursor/artifacts/phase2-dashboard-activity-mobile-390x844.png` |
| 2026-11-27 | Exact application with workflow stages | 1440×900 | `/opt/cursor/artifacts/phase2-exact-record-workflow-1440x900.png` |
| 2026-11-27 | Expanded room and bed occupancy | 1440×900 | `/opt/cursor/artifacts/phase2-dashboard-occupancy-expanded-1440x900.png` |

## Phase 2 non-actions

This phase did not deploy, did not run Wrangler against a remote D1, did not activate SMS, email, or the connector, and did not change Cloudflare, the Pi, or MikroTik. The pull request is not merged.
