# Payments And Receipts Foundation

## Scope

Phase 6 adds manual payment recording, verification, booking payment summaries, payment-slip metadata, receipt issuance, and refund handling to the Cloudflare Workers + Hono + TypeScript app. It does not add payment gateways, automatic Mobile Money integration, branded PDF generation, resident dashboard features, or any dependency on the legacy Django runtime.

## Routes

All routes are mounted under `/admin` and require an authenticated staff session.

- `GET /admin/payments`
- `POST /admin/payments`
- `GET /admin/payments/:id`
- `PATCH /admin/payments/:id/status`
- `POST /admin/payments/:id/verify`
- `POST /admin/payments/:id/reject`
- `POST /admin/payments/:id/refund` (creates a refund **request**; see Refunds)
- `GET /admin/payments/:id/refunds`
- `GET /admin/refunds`, `GET /admin/refunds/:id`
- `POST /admin/refunds/:id/approve|reject|cancel|payout`
- `GET /admin/credit-notes`, `GET /admin/credit-notes/:id`
- `GET /admin/reports/refunds`
- `POST /admin/payments/:id/slip`
- `GET /admin/bookings/:id/payment-summary`
- `POST /admin/payments/:id/receipt`
- `GET /admin/receipts/:id`
- `POST /admin/receipts/:id/void`

## Payment Lifecycle

Payments use the existing statuses:

- `pending`
- `submitted`
- `verified`
- `rejected`
- `refunded`
- `cancelled`
- `archived`

Allowed transitions:

- `pending -> submitted/cancelled/archived`
- `submitted -> verified/rejected/cancelled`
- `verified -> refunded` only by paying out refund records that reach the full payment amount (see Refunds)
- `verified -> archived` only when the payment has no booking, or its booking is no longer active
  (not `pending`/`confirmed`). While the booking is active the request is refused with
  `Payment is verified and linked to an active booking; refund it or end the booking before archiving` (400), nothing
  changes, and `admin.payment.archive_blocked` is audited with `{ bookingId, bookingStatus }`. The same condition is
  repeated inside the conditional `UPDATE`, so a race cannot archive it. The admin UI never offered Archive for verified
  payments; this closes the API path.
- `verified -> archived` is also refused while the payment has an open (`requested`/`approved`) refund:
  `Payment has an open refund; finish or cancel it before archiving` (400). After a verified payment with a booking is
  archived, the booking's payment-attention flag is recalculated on NET verified payments (cause `archive`).
- terminal states may archive where appropriate.

Verification is performed only through the verify endpoint. Clients cannot submit a trusted verified status.

Payment verification now has a D1-compatible update-time overpayment guard. The service still reads the booking payment summary first to produce the normal validation error, but the final `UPDATE payments ... SET status = 'verified'` is also conditional:

- the payment row must still be `submitted`
- the booking's `total_amount_minor` must still be greater than or equal to the current verified total for that booking plus the payment being verified
- the verified-total subquery excludes the payment being updated
- the service requires exactly one changed row

This protects the known race where two submitted payments for the same booking are verified close together after both pass a stale read-time summary check. If another verification wins first and the second payment would overpay the booking, the second conditional update changes zero rows and the service returns `Payment would exceed booking total`. The submitted payment remains submitted for staff review. This does not change payment statuses, receipt rules, booking confirmation thresholds, refund behavior, or financial formulas.

## Part Payments

Multiple payments may be recorded for one booking. Calculated values are derived from payment records:

- `verified_paid_minor = SUM(payments.amount_minor - payments.refunded_amount_minor WHERE status = 'verified')` (NET of paid refunds)
- `balance_minor = bookings.total_amount_minor - verified_paid_minor`

Refunded payments no longer count toward verified totals. Overpayment is rejected in Phase 6.

## Confirmation Threshold

The active row in `payment_confirmation_settings` controls when a pending booking is eligible for confirmation:

- `full`: verified payments must meet the full booking total.
- `fixed`: verified payments must meet a configured fixed minor-unit deposit.
- `percentage`: verified payments must meet configured basis points of the booking total.

Meeting the threshold does not automatically confirm a booking. Accounts, Manager, or Super Admin must perform an explicit confirmation action.

The enforced workflow is:

```text
approved application -> pending booking -> verified payment threshold met -> confirmed booking -> bed allocation
```

## Booking Confirmation Gate

`pending -> confirmed` now checks the calculated payment summary. If the configured threshold is not met, confirmation is rejected. Confirmed bookings remain required before active bed allocation.

## Payment Methods

Supported methods remain:

- `cash`
- `bank_transfer`
- `mobile_money`
- `card`
- `other`

Mobile Money is manually recorded and verified in this phase; no online payment API is integrated.

## Payment Slips And R2

Payment slips are stored privately in the configured `DOCUMENTS` R2 bucket. D1 stores only metadata in `documents` using `document_type = 'payment_slip'`.

Allowed upload content types:

- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/webp`

Maximum upload size is 5 MB. The API stores private R2 object keys and does not expose public R2 URLs.

## Receipts

A receipt may only be issued for a verified payment. Receipt numbers use `KSM-RCP-0001` style values from `receipt_number_sequence`.

Receipt responses join enough data for later PDF generation:

- receipt number
- resident code
- resident/student name
- student ID
- institution
- booking number
- payment reference
- amount
- payment method
- payment/verification date
- outstanding booking balance source data
- issuing staff

Receipts are voided rather than deleted. The schema keeps `payment_id` unique, so one payment cannot receive multiple receipt rows.

## Refunds

Refund milestone 1 (`fix/refund-integrity`, PR #19) made `POST /admin/payments/:id/refund` the single refund entry point.
Milestone 2 (migration **0022**, branch `feat/refund-milestone-2`) replaces the immediate whole-payment refund with refund
records, partial refunds, maker/checker approval, payout references and credit notes.

### Money model

- `payments.refunded_amount_minor` = sum of **paid** refunds against the payment (DB trigger: never decreases, never exceeds
  `amount_minor`). `payments.refund_status` is `none | partially_refunded | fully_refunded`.
- A partial refund keeps the payment `verified` (`refund_status = partially_refunded`). A refund that brings the paid total to
  the full amount sets `status = refunded`, `refund_status = fully_refunded`.
- Net verified = `SUM(amount_minor - refunded_amount_minor)` over `status = 'verified'`. All booking summaries, confirmation,
  overpayment guards, outstanding balances, resident totals and finance reports use NET verified.
- Money only moves at payout. Open requests (`requested`/`approved`) **reserve** the amount: refundable =
  `amount_minor - refunded_amount_minor - open requests` and 0 unless the payment is `verified`. A DB trigger enforces
  `open + paid + new <= amount_minor` on insert (`refund exceeds refundable amount`).
- Legacy milestone-1 refunds are backfilled by 0022 (`refunded_amount_minor = amount_minor`, `fully_refunded`); they have no
  refund record or credit note.

### Lifecycle

`requested -> approved | rejected | cancelled`, `approved -> paid | cancelled`. Terminal states are immutable (DB triggers
for forward-only transitions, immutable identity/amount fields, and no deletes on `refunds` or `credit_notes`).

| Step | Route | Permission | Rules |
| --- | --- | --- | --- |
| Request | `POST /admin/payments/:id/refund` `{ amountMinor?, reason }` → 201 | `refund:request` | Payment verified; `reason` required (legacy `notes` accepted); amount defaults to the remaining refundable amount; positive integer within refundable, else 409 `Refund amount exceeds refundable amount`. |
| Approve | `POST /admin/refunds/:id/approve` `{ note? }` | `refund:approve` | A **different** staff user than the requester; self-approval → 403 `Refund approval by the requester is forbidden` and audited `admin.refund.self_approval_blocked`. Also a DB CHECK. |
| Reject | `POST /admin/refunds/:id/reject` `{ note? }` | `refund:approve` | Different user than the requester (the requester cancels instead). Releases the reservation. |
| Cancel | `POST /admin/refunds/:id/cancel` `{ note? }` | `refund:request` | From `requested`/`approved`, by the requester or any `refund:approve` holder. Releases the reservation. |
| Payout | `POST /admin/refunds/:id/payout` `{ method, reference }` | `refund:payout` | From `approved`. `method` ∈ `cash, bank_transfer, mobile_money, card, other`; `reference` required and unique per method (409 `Payout reference conflict: ...`). |

`PATCH /admin/payments/:id/status` with `status: "refunded"` is still refused
(`Invalid workflow transition: refunds must use POST /admin/payments/:id/refund`).

### Atomicity

Every write is one D1 `batch` (a single SQL transaction). The first statement is a conditional claim that stamps a fresh
`op_token` on the refund row (e.g. `WHERE status = 'approved'` and the payment still verified and within amount); every
following statement is guarded by `op_token = ?`, so a lost race turns the whole batch into a no-op and the service reports
the conflict. Concurrent approvals, approve-vs-cancel, and double payouts therefore cannot both succeed, and sequence numbers
are only consumed by the winner (a payout-reference conflict rolls back with no number gap).

The payout batch: claims `approved -> paid`, updates `refunded_amount_minor` / `refund_status` / `status`, voids the issued
receipt when the payment becomes fully refunded (`void_reason = 'Payment refunded'`, same as milestone 1; partial refunds keep
the receipt), inserts the numbered credit note, bumps the sequence and writes the audit rows.

### Credit notes

`KSM-CRN-0001`… issued at payout, one per refund (`credit_notes.refund_id` unique), linked to the refund, payment, booking,
resident and the payment's receipt (`receipt_id`). Credit notes are never deleted.

### Payment attention

After a payout, a payment verification or the archive of a verified payment, `AdminService.recalculatePaymentAttention`
recomputes the booking's NET verified total against the confirmation requirement (the same rule booking confirmation
enforces):

- not flagged, booking `confirmed`, requirement unmet, cause `refund`/`archive` → flag set (conditional update) with reason
  `Refund reduced verified payments below confirmation threshold` (or the archive equivalent); audited
  `admin.booking.payment_deficiency_after_refund|archive` with `{ paymentId, netVerifiedPaidMinor, requiredConfirmationAmountMinor }`.
- flagged and requirement met on NET → flag cleared (conditional update); audited `admin.booking.payment_attention_cleared`
  with `{ cause, paymentId, netVerifiedPaidMinor, requiredConfirmationAmountMinor }`. A gross total that only reaches the
  requirement because refunds are ignored never clears it.

Historical financial events are never deleted or rewritten; the audit trail keeps every step.

### Reporting

`GET /admin/reports/refunds?dateFrom&dateTo&status` (`report:finance`): `byStatus` (by `requested_at`), `paid` (count, amount,
partial amount by `paid_at`), `byPayoutMethod`, `net` (`gross_verified_minor`, `refunded_minor`, `net_verified_minor`,
`credit_notes_issued`) and up to 500 refund rows (resident code only). The finance report adds `gross_verified_payments` and
`open_refund_totals`; `refunded_totals` is `SUM(refunded_amount_minor)` and `verified_payments` is NET.

### UI

- Admin: Payments → "Request refund" dialog (optional GHS amount, required reason); Finance → **Refunds** page with status
  filter, approve/reject/cancel/payout dialogs, credit-note list and report totals.
- Resident: Payments page shows a read-only "Refunds and credit notes" section (`GET /resident/me/refunds`,
  `GET /resident/me/credit-notes`, own records only, no reasons or staff notes).

## Permissions

- `super_admin`: full financial access.
- `manager`: payment/receipt management and booking confirmation through `booking:confirm`.
- `accounts`: payment verification, rejection, refund request/approve/payout, receipt issuance, financial reads, and booking confirmation through `booking:confirm`.
- `reception`: limited payment intake/read; no verification or refund authority.
- Refund permissions (`refund:read`, `refund:request`, `refund:approve`, `refund:payout`, `credit_note:read`) are granted to
  `manager` and `accounts` (`super_admin` has `*`). Maker/checker is per user, not per role.
- `maintenance`: no financial access.
- `resident`: no `/admin` financial access.

## Audit Events

Phase 6 records:

- `admin.payment.create`
- `admin.payment.submitted`
- `admin.payment.verified`
- `admin.payment.rejected`
- `admin.payment.refunded`
- `admin.payment.slip_uploaded`
- `admin.receipt.issued`
- `admin.receipt.voided`
- `admin.booking.payment_threshold_reached`
- `admin.booking.confirmed`
- `admin.booking.payment_deficiency_after_refund`
- `admin.booking.payment_deficiency_after_archive`
- `admin.booking.payment_attention_cleared`
- `admin.refund.requested|approved|rejected|cancelled|paid`, `admin.refund.self_approval_blocked`
- `admin.credit_note.issued`

Refund audit metadata contains ids, amounts, statuses and payout method only — never reasons, decision notes, payout
references or resident PII. `admin.payment.refunded` is `{ refundId, bookingId, amountMinor, refundedTotalMinor, refundStatus }`.

Payment-slip contents and authentication secrets are never logged.

## Migrations

```text
cloudflare/migrations/0005_payments_receipts_foundation.sql
cloudflare/migrations/0022_refund_records_credit_notes.sql
```

0022 (additive only) adds `payments.refunded_amount_minor`, `payments.refund_status` (+ backfill of legacy refunded
payments), the `refunds` and `credit_notes` tables, `refund_number_sequence` (`KSM-RFD`) and
`credit_note_number_sequence` (`KSM-CRN`), and the guard triggers described above.

Adds:

- `payment_reference_sequence`
- `receipt_number_sequence`
- `payment_confirmation_settings`
- `bookings.payment_attention_required`
- `bookings.payment_attention_reason`

## Test Results

Latest local validation:

```text
npm.cmd run typecheck
tsc --noEmit passed

npm.cmd test
3 test files passed
46 tests passed
```
