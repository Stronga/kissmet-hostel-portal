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
- `POST /admin/payments/:id/refund`
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
- `verified -> refunded/archived`
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

- `verified_paid_minor = SUM(payments.amount_minor WHERE status = 'verified')`
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

Only verified payments may be refunded. Refunded payments stop counting toward `verified_paid_minor`.

If a refund causes an already confirmed booking to fall below the active confirmation threshold, the booking status is not silently changed. The booking is flagged with `payment_attention_required = 1` and an audit event is recorded.

## Permissions

- `super_admin`: full financial access.
- `manager`: payment/receipt management and booking confirmation through `booking:confirm`.
- `accounts`: payment verification, rejection, refund, receipt issuance, financial reads, and booking confirmation through `booking:confirm`.
- `reception`: limited payment intake/read; no verification authority.
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

Payment-slip contents and authentication secrets are never logged.

## Migrations

```text
cloudflare/migrations/0005_payments_receipts_foundation.sql
```

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
