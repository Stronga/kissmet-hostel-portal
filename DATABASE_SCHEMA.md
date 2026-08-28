# Kissmet Hostel D1 Database Schema

## Overview

This schema is the canonical Cloudflare D1 schema for the Kissmet Hostel portal. It is designed for one hostel with fewer than 20 rooms, with normalized room/bed inventory, session-specific room rates, explicit operational statuses, integer minor-unit money values, R2-backed document references, expiring OTP records, revocable sessions, and append-only audit records.

The first migration is:

```text
cloudflare/migrations/0001_canonical_schema.sql
```

Schema hardening migrations are:

```text
cloudflare/migrations/0002_auth_username.sql
cloudflare/migrations/0003_resident_code_sequence.sql
cloudflare/migrations/0004_booking_number_sequence.sql
cloudflare/migrations/0005_payments_receipts_foundation.sql
cloudflare/migrations/0006_resident_onboarding.sql
cloudflare/migrations/0007_operations_reporting.sql
cloudflare/migrations/0008_booking_priced_room.sql
```

Development seed data is:

```text
cloudflare/seeds/development.sql
```

## General Decisions

- Primary keys use `INTEGER PRIMARY KEY`, compatible with SQLite/D1 row ids.
- Foreign keys use `ON DELETE RESTRICT` for operational and financial history that must not be silently removed.
- Soft archival is represented with `status = 'archived'` and/or `archived_at`.
- Timestamps are UTC ISO-8601 text values using `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`.
- The default application currency is `GHS`.
- Money is stored as integer minor units, for example Ghana pesewas in `amount_minor` and `total_amount_minor`.
- R2 files are referenced by bucket/key metadata only. Binary content is never stored in D1.
- Partial unique indexes enforce active-state business rules while preserving historical records.

## Tables

### `roles`

Stores staff role definitions.

- Important fields: `code`, `name`, `description`, `is_system`.
- Unique constraints: `code`.
- Seed roles: `super_admin`, `manager`, `reception`, `accounts`, `maintenance`.

### `users`

Stores identity records shared by residents, staff, and system actors.

- Important fields: `email`, `phone`, `display_name`, `user_type`, `status`, `password_hash`.
- Phase 3 adds nullable `username` through `cloudflare/migrations/0002_auth_username.sql` for staff/admin login by email or username.
- Status values: `active`, `inactive`, `suspended`, `archived`.
- User type values: `resident`, `staff`, `system`.
- Unique constraints: `email`, `phone`, `username`.
- Authentication is not implemented in Phase 2; `password_hash` exists for the later staff/admin auth phase.

### `staff`

Stores staff profile records connected to `users` and `roles`.

- Relationships: `staff.user_id -> users.id`, `staff.role_id -> roles.id`.
- Status values: `active`, `inactive`, `archived`.
- Unique constraints: `user_id`, `staff_code`.

### `academic_sessions`

Stores hostel academic/session periods.

- Status values: `draft`, `active`, `closed`, `archived`.
- Unique constraints: `code`.
- Active-session rule: partial unique index allows only one row where `status = 'active'`.
- Date rule: `starts_on <= ends_on`.

### `institutions`

Stores schools/institutions that issue student IDs.

- Important fields: `code`, `name`, `status`.
- Status values: `active`, `inactive`, `archived`.
- Unique constraints: `code`.

### `residents`

Stores resident/student profile records linked to `users`.

- Relationships: `residents.user_id -> users.id`.
- `resident_code` is Kissmet's internal resident identifier. It is system-generated when a resident record is created and is not required for normal portal login.
- Resident codes use the public internal format `KSM-RES-0001`, `KSM-RES-0002`, and so on. They are allocated from `resident_code_sequence`, not derived from or equal to the D1 integer primary key.
- `student_id` is the resident's external school or institution student ID.
- `institution_id` links the student ID to the issuing institution.
- `middle_name` stores the optional structured middle name for onboarding.
- `phone_verified_at` records registration phone verification before a normal resident session is issued.
- Status values: `prospect`, `applicant`, `resident`, `past_resident`, `suspended`, `archived`.
- Unique constraints: `user_id`, `resident_code`, `(institution_id, student_id)`.
- Student IDs are not assumed to be globally unique. The same `student_id` may exist at different institutions, but each `(institution_id, student_id)` pair maps to exactly one resident record.

### `resident_code_sequence`

Stores the next numeric value used to allocate Kissmet resident reference codes.

- Single-row table: `id = 1`.
- Important fields: `prefix`, `next_value`, `padding`.
- Default format: `KSM-RES-` plus a zero-padded sequence number with at least four digits.
- The service layer allocates a code with a compare-and-swap update on `next_value`, then inserts it into `residents.resident_code`.
- `residents.resident_code` remains unique, so D1 rejects any unexpected collision instead of silently duplicating codes.

### `rooms`

Stores normalized room inventory.

- A room can contain multiple beds through `beds.room_id`.
- Important fields: `room_code`, `capacity`, `gender_policy`, `status`.
- Individual `beds` rows are the authoritative source of actual occupancy and bed inventory.
- `rooms.capacity` is the configured maximum capacity. Application services must prevent creating active beds beyond this configured capacity.
- Gender policy values: `female`, `male`, `any`.
- Status values: `available`, `maintenance`, `inactive`, `archived`.
- Unique constraints: `room_code`.

### `beds`

Stores normalized bed inventory.

- Relationships: `beds.room_id -> rooms.id`.
- Status values: `available`, `maintenance`, `inactive`, `archived`.
- Unique constraints: `bed_code`, `(room_id, label)`.

### `room_rates`

Stores room pricing by academic session so historical prices are preserved.

- Relationships: `room_rates.room_id -> rooms.id`, `room_rates.academic_session_id -> academic_sessions.id`.
- Status values: `draft`, `active`, `inactive`, `archived`.
- Money fields: `amount_minor`, `currency`.
- Default currency: `GHS`.
- Unique constraints: `rate_code`.
- Active rate rule: partial unique index prevents more than one active rate for the same room/session.
- Rates are versioned by session and status rather than overwritten.

### `applications`

Stores resident application records for a session.

- Relationships: `resident_id -> residents.id`, `academic_session_id -> academic_sessions.id`, `reviewed_by_staff_id -> staff.id`.
- Status values: `draft`, `submitted`, `under_review`, `approved`, `rejected`, `cancelled`, `archived`.
- Unique constraints: `application_number`.
- Application numbers use the format `KSM-APP-0001`, `KSM-APP-0002`, and so on. They are allocated from `application_number_sequence`, not derived from the D1 integer primary key.
- Active application rule: partial unique index prevents multiple active application records for the same resident/session while allowing rejected, cancelled, and archived history.
- Approval rule: approving an application must not automatically allocate a bed. Approval only means the applicant is eligible to proceed to booking/placement. Bed allocation remains a separate explicit staff action.

### `bookings`

Stores booking records for approved/active resident placement workflows.

- Relationships: `resident_id -> residents.id`, `academic_session_id -> academic_sessions.id`, `application_id -> applications.id`.
- Status values: `pending`, `confirmed`, `cancelled`, `expired`, `completed`, `archived`.
- Money fields: `total_amount_minor`, `currency`.
- Pricing source fields: `priced_room_id`, `priced_room_rate_id`.
- Unique constraints: `booking_number`.
- Active booking rule: partial unique index prevents duplicate `pending` or `confirmed` bookings for the same resident/session.
- Booking rule: a booking may reference an approved application, but creating or confirming a booking must still not implicitly create an allocation unless a future service explicitly implements and names that combined operation.
- Booking numbers use the format `KSM-BKG-0001`, `KSM-BKG-0002`, and so on. They are allocated from `booking_number_sequence`, not derived from the D1 integer primary key.
- Confirmation rule: `pending -> confirmed` requires the active payment confirmation setting to be satisfied by verified, non-refunded payments. Confirmation remains an explicit staff action.
- Payment attention fields: `payment_attention_required`, `payment_attention_reason`. Refunds that make an already confirmed booking fall below the threshold flag attention instead of silently changing booking status.
- Financial basis rule: new bookings persist the room selected for pricing in `priced_room_id` and the active room-rate row used in `priced_room_rate_id`. `total_amount_minor` and `currency` remain the immutable captured financial basis used by payment confirmation, receipts, refunds, and payment-attention checks.

### `booking_number_sequence`

Stores the next numeric value used to allocate Kissmet booking numbers.

- Single-row table: `id = 1`.
- Important fields: `prefix`, `next_value`, `padding`.
- Default format: `KSM-BKG-` plus a zero-padded sequence number with at least four digits.
- The service layer allocates a booking number with a compare-and-swap update on `next_value`, then inserts it into `bookings.booking_number`.
- `bookings.booking_number` remains unique, so D1 rejects any unexpected collision instead of silently duplicating booking numbers.

### `application_number_sequence`

Stores the next numeric value used to allocate Kissmet application numbers.

- Single-row table: `id = 1`.
- Default format: `KSM-APP-` plus a zero-padded sequence number with at least four digits.

### `allocations`

Stores bed assignment history.

- Relationships: `booking_id -> bookings.id`, `resident_id -> residents.id`, `academic_session_id -> academic_sessions.id`, `bed_id -> beds.id`, `assigned_by_staff_id -> staff.id`.
- Status values: `active`, `ended`, `cancelled`, `transferred`, `archived`.
- Active bed rule: partial unique index prevents more than one active allocation per bed.
- Active resident/session rule: partial unique index prevents more than one active allocation for a resident in the same session.
- History is preserved by ending/transferring allocations instead of deleting them.
- Allocation rule: active bed assignment is created only through an explicit allocation workflow that selects a specific bed and records the assigning staff member.
- Priced-room rule: normal allocation must target the booking's priced room, unless the selected bed is in another room whose active rate for the booking session has the same `amount_minor` and `currency` as the booking's captured financial basis. Differently priced cross-room allocation is rejected.
- Transfer rule: same-room transfers do not reprice. Cross-room transfers are allowed only when the destination room's active session rate has the same amount and currency as the booking's captured financial basis. Historical room-rate rows are never mutated to make a transfer work.

### `payments`

Stores payment records.

- Relationships: `booking_id -> bookings.id`, `resident_id -> residents.id`, `verified_by_staff_id -> staff.id`.
- Status values: `pending`, `submitted`, `verified`, `rejected`, `refunded`, `cancelled`, `archived`.
- Money fields: `amount_minor`, `currency`.
- Payment method values: `cash`, `bank_transfer`, `mobile_money`, `card`, `other`.
- Unique constraints: `payment_reference`.
- `amount_minor` must be greater than zero.
- Payment references use the format `KSM-PAY-0001`, `KSM-PAY-0002`, and so on. They are allocated from `payment_reference_sequence`, not derived from the D1 integer primary key.
- Verified totals and balances are calculated from `payments`; no manually maintained booking balance is stored.

### `payment_reference_sequence`

Stores the next numeric value used to allocate Kissmet payment references.

- Single-row table: `id = 1`.
- Default format: `KSM-PAY-` plus a zero-padded sequence number with at least four digits.

### `payment_confirmation_settings`

Stores the active booking confirmation requirement.

- Requirement types: `full`, `fixed`, `percentage`.
- `full`: verified payments must equal the booking total.
- `fixed`: verified payments must meet `fixed_amount_minor`, capped at the booking total.
- `percentage`: verified payments must meet `percentage_basis_points` of the booking total.
- The default row requires full payment in `GHS`.

### `receipts`

Stores issued receipt records.

- Relationships: `payment_id -> payments.id`, `issued_by_staff_id -> staff.id`.
- Status values: `issued`, `voided`, `archived`.
- Unique constraints: `payment_id`, `receipt_number`.
- Receipts are voided, not deleted.
- Receipt numbers use the format `KSM-RCP-0001`, `KSM-RCP-0002`, and so on. They are allocated from `receipt_number_sequence`, not derived from the D1 integer primary key.
- A payment may have only one active issued receipt.

### `receipt_number_sequence`

Stores the next numeric value used to allocate Kissmet receipt numbers.

- Single-row table: `id = 1`.
- Default format: `KSM-RCP-` plus a zero-padded sequence number with at least four digits.

### `documents`

Stores R2 object metadata and links to domain records.

- Relationships may point to owner user, resident, application, booking, payment, or receipt.
- Document type values: `student_card`, `ghana_card`, `profile_photo`, `application_support`, `payment_slip`, `receipt_pdf`, `other`.
- Status values: `uploaded`, `verified`, `rejected`, `deleted`, `archived`.
- R2 fields: `r2_bucket`, `r2_key`, `original_filename`, `content_type`, `size_bytes`, `checksum_sha256`.
- Unique constraints: `r2_key`.
- No binary file contents are stored in D1.
- Student Card and Ghana Card files must be stored privately in R2; D1 stores only metadata and object references.
- Ghana Card numbers must not be used as authentication credentials.
- Ownership rule: document links must be internally consistent. For example, a payment-slip document linked to a `payment_id` must belong to the same resident as that payment; a receipt document linked to a `receipt_id` must trace through its payment to the same resident; an application document must belong to the same resident as the application. These cross-table ownership rules are enforced in the service layer because SQLite `CHECK` constraints cannot query other tables.
- A document may be attached to multiple related records only when those records belong to the same resident workflow. Services must reject documents attached to unrelated residents, bookings, payments, or receipts.

### `maintenance_requests`

Stores resident or room maintenance issues.

- Relationships may point to resident, room, bed, and assigned staff.
- Request numbers use the format `KSM-MNT-0001`, `KSM-MNT-0002`, and so on. They are allocated from `maintenance_request_sequence`, not derived from the D1 integer primary key.
- Category values: `plumbing`, `electrical`, `furniture`, `cleaning`, `security`, `other`.
- Priority values: `low`, `normal`, `high`, `urgent`.
- Status values: `open`, `assigned`, `in_progress`, `resolved`, `closed`, `cancelled`, `archived`.
- Lifecycle timestamps: `opened_at`, `assigned_at`, `started_at`, `resolved_at`, `closed_at`, `archived_at`.
- Valid workflow transitions are `open -> assigned/cancelled`, `assigned -> in_progress/cancelled`, `in_progress -> resolved/cancelled`, `resolved -> closed/in_progress`, `closed -> archived`, and `cancelled -> archived`.
- Unique constraints: `request_number`.

### `maintenance_request_sequence`

Stores the next numeric value used to allocate Kissmet maintenance request numbers.

- Single-row table: `id = 1`.
- Default format: `KSM-MNT-` plus a zero-padded sequence number with at least four digits.
- `maintenance_requests.request_number` remains unique, so D1 rejects any unexpected collision.

### `announcements`

Stores operational announcements.

- Relationships: `published_by_staff_id -> staff.id`.
- Audience values: `all`, `residents`, `staff`.
- Status values: `draft`, `published`, `expired`, `archived`.
- Valid workflow transitions are `draft -> published/archived`, `published -> expired/archived`, and `expired -> archived`.
- Resident portal visibility is restricted to `audience IN ('all', 'residents')`, `status = 'published'`, and non-expired announcements.

### `otp_codes`

Stores OTP challenges for later authentication flows.

- Relationships may point to `users` and `residents`.
- Purpose values: `resident_login`, `phone_verification`, `password_reset`.
- Status values: `pending`, `used`, `expired`, `revoked`.
- Expiration: `expires_at`.
- One-time use: `status`, `used_at`.
- Attempt limits: `attempt_count`, `max_attempts`, and `CHECK (attempt_count <= max_attempts)`.
- Rate limiting: `rate_limit_key`, `requested_at`, `request_ip_hash`, plus index on `(rate_limit_key, purpose, requested_at)`.
- OTP codes are stored as `code_hash`, never plaintext.
- Registration OTPs use `purpose = 'phone_verification'` and store temporary onboarding payload in `registration_payload_json` until successful one-time verification creates the user/resident records.

### `sessions`

Stores later application sessions.

- Relationships: `sessions.user_id -> users.id`.
- Status values: `active`, `expired`, `revoked`.
- Expiration: `expires_at`.
- Revocation: `revoked_at`, `revocation_reason`.
- Unique constraints: `session_token_hash`.
- Session tokens are stored as hashes, never plaintext.

### `audit_logs`

Stores append-only operational audit events.

- Relationships may point to actor user and actor staff.
- Required fields: `action`, `entity_type`, `created_at`.
- Entity reference: `entity_type`, `entity_id`.
- Optional context: `metadata_json`, `ip_hash`, `user_agent`.
- Actor deletion uses `ON DELETE SET NULL` so historical logs remain.

## Important Indexes

- `idx_one_active_academic_session`: only one active academic session.
- `idx_applications_one_active_per_resident_session`: prevents duplicate active applications.
- `idx_bookings_one_active_per_resident_session`: prevents duplicate pending/confirmed bookings.
- `idx_bookings_priced_room`: supports booking financial-basis checks by priced room.
- `idx_bookings_priced_room_rate`: supports booking financial-basis checks by original room-rate row.
- `idx_allocations_one_active_bed`: prevents more than one active allocation per bed.
- `idx_allocations_one_active_resident_session`: prevents more than one active allocation per resident/session.
- `idx_room_rates_one_active_per_room_session`: prevents more than one active room rate per room/session.
- Lookup indexes cover status, session, room/bed, resident/payment, OTP rate limiting, sessions, and audit queries.

## Verification

Schema verification SQL lives in:

```text
cloudflare/tests/schema-verification.sql
```

It covers:

- resident creation
- room creation
- multiple beds per room
- room rate creation
- application creation
- booking creation
- bed allocation
- payment creation
- receipt creation
- document metadata creation
- maintenance request creation
- announcement creation
- OTP record creation
- session creation
- audit log creation

Constraint failure checks live in separate files because they are expected to fail:

```text
cloudflare/tests/constraint-duplicate-active-booking.sql
cloudflare/tests/constraint-duplicate-active-allocation.sql
cloudflare/tests/constraint-duplicate-room-rate.sql
cloudflare/tests/constraint-invalid-money.sql
cloudflare/tests/constraint-invalid-foreign-key.sql
```
