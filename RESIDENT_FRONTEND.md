# Resident Frontend

Phase R1 added a separate Resident Portal frontend at `resident-frontend/`.
Phase R2 replaces the auth placeholders with real resident registration and OTP authentication against the existing Cloudflare/Hono backend.
Phase R3 replaces the neutral Home and Profile placeholders with real resident-owned dashboard and profile views.
Phase R4 replaces the Documents placeholder with real Student Card and Ghana Card upload management.
Phase R5 replaces the Application placeholder with the real resident draft/submission workflow.
Phase R6 replaces the Booking placeholder with a real read-only resident booking lifecycle view.
Phase R7 replaces the Payments placeholder with resident-owned payment submission, payment slip upload, and receipt history.

## Stack

- React 19
- TypeScript
- Vite
- React Router
- Tailwind CSS
- Vitest and Testing Library

The app is intentionally separate from `admin-frontend/` and does not depend on the legacy Django runtime.

## Environment

Resident frontend configuration uses:

```text
VITE_API_BASE_URL=http://localhost:8787
```

Production API and portal domains are expected to be:

- API: `https://api.kissmetgroup.org`
- Resident Portal: `https://portal.kissmetgroup.org`

Production URLs are not hardcoded in React components.

## Routes

Public routes:

- `/login`
- `/register`
- `/verify-otp`

Protected resident routes:

- `/home`
- `/profile`
- `/documents`
- `/application`
- `/booking`
- `/payments`
- `/room`
- `/maintenance`
- `/messages`
- `/announcements`

`/` redirects to `/home` when authenticated and `/login` when unauthenticated.

## Authentication And Session Foundation

- Session token storage key: `kissmet_resident_token`
- Token storage is intentionally separate from Admin's `kissmet_admin_token`.
- Session restore calls `GET /auth/me`.
- Logout calls `POST /auth/logout`, clears local state, and redirects to `/login`.
- `401` API responses clear resident auth state.
- `/auth/me` must return `userType = resident`, `role = resident`, and a non-null `residentId`.
- Staff/admin sessions are rejected safely and are not treated as resident sessions.

Existing resident login uses:

```text
GET /public/institutions
POST /auth/resident/request-otp
POST /auth/resident/verify-otp
GET /auth/me
```

The resident enters an active institution and student ID. Institution choices come from the public-safe institution endpoint and the frontend submits the selected institution `code`, not a hardcoded ID. The OTP request response is intentionally generic and does not expose whether an arbitrary resident exists.

Successful OTP verification returns a bearer token. The frontend stores it under `kissmet_resident_token`, calls `GET /auth/me`, verifies the session belongs to a resident, and redirects to `/home`.

New applicant registration uses:

```text
GET /public/institutions
POST /resident/register/request-otp
POST /resident/register/verify-otp
GET /auth/me
```

The registration form submits the fields accepted by the backend contract: first name, optional middle name, last name, phone, optional email, institution code, and student ID. Permanent user/resident creation remains backend-owned and happens only after successful phone OTP verification. Resident code allocation remains backend-owned.

`/verify-otp` supports explicit `login` and `registration` flow context. The temporary context is stored in `sessionStorage` under `kissmet_resident_verification_context`, contains only the minimum data needed to complete verification/resend, and is cleared after success or when the user changes details. If the page is refreshed without context, it fails safely and asks the resident to restart login or registration.

Resend uses the same backend OTP request endpoint for the active flow. The backend's expiry, attempt, and rate-limit rules remain authoritative; the frontend only disables duplicate submission while a resend is in progress.

## API Client

All HTTP calls go through `src/api/client.ts`.

The client centralizes:

- `VITE_API_BASE_URL`
- bearer token attachment
- JSON parsing
- `Content-Type` and `Authorization` headers
- consistent `ApiError`
- unauthorized-session clearing hook

No production UI uses mock residents or fake API responses.

Resident auth API wrappers live in `src/api/residentAuth.ts`, public institution loading lives in `src/api/institutions.ts`, and resident-owned dashboard/profile API wrappers live in `src/api/resident.ts`.
Identity document upload uses authenticated `FormData` through the same API client. The client does not manually set multipart boundaries.
Resident application creation/submission also uses `src/api/resident.ts` and never calls admin application endpoints.
Resident booking display uses the same API layer and remains read-only.
Resident payments, payment slip uploads, payment summaries, and receipt history use the same API layer and never call admin payment or receipt endpoints.

## Shell And Navigation

The resident shell is mobile-first:

- desktop/tablet header and compact side navigation
- mobile header and bottom navigation
- mobile primary items: Home, Application, Payments, My Room, More
- More menu: Booking, Maintenance, Messages, Announcements, Profile, Documents, Logout

The shell uses a lighter resident visual treatment: light background, white cards, teal accent, larger touch targets, and simple status chips.

## Home Dashboard

`/home` is a real resident dashboard backed by resident-owned endpoints only:

- `GET /resident/me`
- `GET /resident/me/documents`
- `GET /resident/me/applications`
- `GET /resident/me/bookings`
- `GET /resident/me/allocation`
- `GET /resident/me/payments/summary`

The profile request is required for the dashboard to render. Documents, applications, bookings, and allocation are loaded independently so partial failures show a warning without hiding the resident identity and available sections.

The dashboard shows:

- resident identity summary: name, resident code, institution, student ID, phone, email, and status
- next-action card derived from real journey state
- accommodation journey stages: account, documents, application, booking, payment, and room assignment
- latest application summary from resident application records
- latest booking summary from resident booking records
- resident-safe payment summary from verified payment totals
- active room assignment only from `GET /resident/me/allocation`

Room assignment never comes from application, booking, or payment records. A room is shown only when the backend reports an active allocation.

Payment progress uses the resident-safe summary endpoint. Verified totals, outstanding balance, confirmation requirement, and payment-attention state are derived by the backend from the authenticated resident session. Submitted and pending payments are shown separately from verified totals and do not reduce the outstanding balance until staff verification.

## Profile

`/profile` displays safe resident-owned information from `GET /resident/me`:

- full name
- resident code
- status
- institution
- student ID
- phone
- email
- phone verification date when present

The page does not display database IDs, OTP/session hashes, Ghana Card numbers, staff-only notes, or document storage references.

Profile editing uses the existing `PATCH /resident/me` contract and supports only:

- first name
- middle name
- last name
- email

Resident code, institution, student ID, and phone remain read-only because they are identity/login fields and are not supported by the current resident self-service update endpoint. The frontend never generates or modifies `resident_code`.

## Documents

`/documents` is a real resident document page for the two required R4 identity document types:

- Student Card: backend `document_type = student_card`
- Ghana Card: backend `document_type = ghana_card`

The page uses resident-owned endpoints only:

- `GET /resident/me/documents`
- `POST /resident/me/documents/student-card`
- `POST /resident/me/documents/ghana-card`

The page does not call admin document endpoints and does not accept or send arbitrary resident IDs. Ownership is derived by the backend from the authenticated resident session.

Each document card shows resident-safe metadata when available:

- current filename
- content type
- file size
- uploaded timestamp
- status

Status labels are mapped for resident readability:

- `uploaded` -> Awaiting verification
- `verified` -> Verified
- `rejected` -> Needs attention
- missing document -> Not uploaded

Upload completeness and staff verification are separate. The readiness summary says `0 of 2 uploaded`, `1 of 2 uploaded`, or `2 of 2 uploaded`; it does not claim identity verification merely because files exist.

Resident-side upload validation matches the current backend contract:

- allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`
- maximum size: 5 MB
- upload field name: `file`

Frontend validation is for usability only. The Cloudflare backend remains authoritative for MIME validation, size enforcement, R2 object-key generation, ownership, and audit behavior.

Replacement and re-upload behavior follows the current backend contract: uploading inserts a new private document record for the resident. The page uses the latest document per identity type for display. Missing documents show Upload, rejected documents show Re-upload, and existing uploaded/verified documents show Replace. The frontend never deletes old R2 objects and never mutates document verification state.

The current resident backend exposes metadata but not document file content. R4 therefore does not show a View or Download action. It never constructs public R2 URLs, exposes R2 object keys, displays bucket names, extracts Ghana Card numbers, performs OCR, or stores identity numbers in frontend state.

The backend was hardened so `GET /resident/me/documents/:id` no longer returns `r2_key` in resident metadata responses.

## Application

`/application` is a real resident application workflow page backed by resident-owned endpoints only:

- `GET /resident/me`
- `GET /resident/me/documents`
- `GET /resident/me/applications`
- `GET /resident/me/academic-session`
- `POST /resident/me/applications`
- `POST /resident/me/applications/:id/submit`

The frontend does not send `resident_id`, `user_id`, `application_number`, review status, `reviewed_by_staff_id`, or ownership fields. Resident identity is derived from the authenticated session, and application numbers remain backend-generated in the `KSM-APP-xxxx` format.

R5 added `GET /resident/me/academic-session` because the existing resident create endpoint required an `academicSessionId` and there was no resident-safe way to discover the active session. The backend rejects resident draft creation for non-active sessions.

The Application page supports:

- no-application state with Start application action
- draft application state
- submitted state
- under review state
- approved state
- rejected state
- archived/cancelled history display when exposed by the backend
- application history list when multiple resident-owned records are returned

Draft creation creates a backend-owned draft for the active academic session only. The generated application number is shown after the backend confirms creation. Duplicate active applications remain blocked by backend constraints and surfaced as API errors.

The readiness checklist derives from resident-owned profile and document data when no dedicated backend readiness endpoint is available. Submission still relies on backend validation. Current readiness items are:

- phone verified
- profile complete: structured name, institution, and student ID
- Student Card uploaded
- Ghana Card uploaded

Documents with `uploaded` or `verified` status count as submission-ready. Rejected or missing documents block readiness. Staff verification is separate and is not required for resident submission under the current backend rule.

Submitting a draft requires confirmation, prevents duplicate submit clicks, waits for backend confirmation before updating state, and refreshes resident application data afterward. Failed submission leaves the displayed status unchanged and shows the backend error.

Lifecycle labels preserve backend semantics:

- `draft` -> Draft
- `submitted` -> Submitted
- `under_review` -> Under Review
- `approved` -> Approved
- `rejected` -> Rejected
- `cancelled` -> Cancelled
- `archived` -> Archived

Approval is presented as eligibility for the next booking stage only. R5 does not create a booking, assign a room, mark payment complete, or collapse application/booking/payment/allocation into one status.

The timeline renders only real backend timestamps: `created_at`, `submitted_at`, and `reviewed_at`. Missing timestamps are not fabricated.

Rejected applications show `decision_notes` only because that field is already exposed by the resident endpoint. If it is absent, the UI shows a neutral fallback message.

## Booking

`/booking` is a real resident booking view. R6 is read-only because the current backend treats booking creation and confirmation as admin/operational workflow after application approval.

The page uses resident-owned endpoints only:

- `GET /resident/me/bookings`
- `GET /resident/me/applications`
- `GET /resident/me/allocation`
- `GET /resident/me/payments/summary`

The frontend does not call admin booking, room, payment, or allocation APIs. It never sends or exposes arbitrary `resident_id`, `user_id`, booking owner fields, `priced_room_rate_id`, staff IDs, or audit metadata.

The resident booking response was expanded with safe labels and timestamps:

- booking number
- status
- academic session code/name
- related application number
- captured `total_amount_minor`
- currency
- booked/created/expiry/cancelled/completed timestamps
- priced room code/name
- resident-safe payment-attention fields

Internal pricing IDs remain hidden. The resident page displays the priced room as `Room used for booking price`, not `Your Room`.

Booking lifecycle labels preserve backend semantics:

- `pending` -> Pending
- `confirmed` -> Confirmed
- `cancelled` -> Cancelled
- `expired` -> Expired
- `completed` -> Completed
- `archived` -> Archived

The captured financial basis is always the booking's stored `total_amount_minor` and `currency`. The Resident Portal does not recalculate booking amounts from current room rates and does not fetch newer room rates to overwrite historical booking obligations.

Payment-stage totals come from the resident-safe payment summary endpoint. The page shows captured amount due, verified payments, and outstanding balance without calling admin payment APIs or fabricating `GHS 0.00` values.

`payment_attention_required` may appear on confirmed bookings. This is valid because refunds can flag attention without automatically de-confirming a booking. The UI shows a resident-friendly warning when the field is present.

Actual room/bed assignment comes only from `GET /resident/me/allocation`. A confirmed booking without allocation shows that no room or bed has been assigned yet. A priced room alone is never treated as an allocation.

Booking history is shown when multiple resident-owned bookings are returned. Pending/confirmed bookings are treated as current; cancelled, expired, completed, archived, and older records are shown as history.

## Payments And Receipts

`/payments` is a real resident payment page backed by resident-owned endpoints only:

- `GET /resident/me/payments/summary`
- `GET /resident/me/payments`
- `POST /resident/me/payments`
- `POST /resident/me/payments/:id/submit`
- `POST /resident/me/payments/:id/slip`
- `GET /resident/me/receipts`
- `GET /resident/me/receipts/:id`

The payment summary displays booking total, verified total, outstanding balance, submitted total, draft/pending total, refunded total, required amount before booking confirmation, and remaining amount needed for eligibility. Calculations are resident-safe and backend-owned. Only `verified` payments reduce outstanding balance. `submitted` and `pending` payments are visible but remain unverified. Refunded payments are shown for history and do not reduce the outstanding balance.

Part payments are supported. The frontend accepts a GHS decimal amount for usability, converts it to integer minor units before submission, and never persists money as floating point. Payment creation sends only the selected resident-owned booking ID, integer amount, currency, method, and optional note. The frontend never sends `resident_id`, `payment_reference`, status, staff verification fields, or receipt fields. Payment references remain backend-generated.

Allowed resident payment methods are `cash`, `bank_transfer`, `mobile_money`, `card`, and `other`. The backend remains authoritative for method validation, booking ownership, currency matching, amount limits, and workflow transitions.

Payment slip upload is private. The frontend sends authenticated `FormData` with field name `file` and accepts only PDF, JPEG, PNG, and WebP files up to 5 MB. R2 object keys, bucket names, and public storage URLs are never displayed or constructed in the frontend. Slip content viewing/downloading is not exposed by the current resident backend.

Residents can submit a `pending` payment for staff verification. Submission changes the payment to `submitted`; it does not verify payment, issue a receipt, or confirm the booking. Staff-only verification and booking confirmation remain backend/admin operations. Staff verification includes an update-time overpayment guard so concurrent verification attempts cannot silently push verified totals beyond the booking total. Rejected payments can be viewed historically; residents create a new payment record rather than bypassing backend status rules with a frontend-only resubmission path.

Receipt history is read-only for residents. The page lists issued and voided receipt metadata tied to resident-owned payments. Residents cannot issue, void, refund, verify, or mutate receipts from the portal. Receipt PDF/content download remains unavailable until a resident-safe backend streaming endpoint is added.

Payment attention can appear on confirmed bookings after refunds or other staff payment actions. The portal shows this as a resident-facing warning without changing booking status or verified payment history.

## Reusable Components And Utilities

R1 adds:

- `Button`
- `Card`
- `StatusBadge`
- `LoadingState`
- `EmptyState`
- `ErrorState`
- `FormField`
- `PageHeader`
- `ResidentHeader`
- `MobileNav`
- date/time formatter
- GHS minor-unit money formatter
- status label formatter

Money formatting accepts integer minor units and does not perform floating-point financial calculations for persistence.

## Branding

The backend settings module stores `organization_name` and `resident_portal_title`, but `GET /admin/settings` is admin-only. The Resident Portal does not call admin settings endpoints in R1 and uses safe static Kissmet labels.

Dynamic resident branding should be introduced later through a resident/public-safe settings endpoint without weakening Admin Settings RBAC.

## Security Boundaries

The Resident Portal does not add:

- admin routes
- staff controls
- audit log or report access
- settings mutation
- arbitrary resident ID access
- document public URLs
- OTP/session/password hash exposure

Student Card and Ghana Card files remain private R2 objects and require backend-mediated access in later phases.

For R4, resident document content retrieval is intentionally unavailable because no resident-safe content endpoint exists. The UI shows metadata/upload state only.

Auth errors are mapped to resident-safe messages. The UI does not expose SQL errors, stack traces, OTP hashes, session-token hashes, registration payload internals, or staff auth state.

## Known Limitations

R7 completes resident payment submission, payment slip upload, payment summaries, and receipt history. The following remain later phases:

- maintenance requests
- announcements
- resident message inbox

Profile phone, institution, and student ID self-service changes are not implemented because the backend does not currently expose those operations for residents.

Resident document viewing/download remains unavailable until a backend endpoint can stream private R2 content through authenticated resident ownership checks.

The Application page has no cancellation action because the current resident backend does not expose a cancellation endpoint. Booking creation/actions remain outside R5.

The Booking page has no resident create, confirm, or cancel action because the current resident backend does not expose those operations.

Payment slip and receipt content viewing/downloading remain unavailable until backend endpoints can stream private R2 content through authenticated resident ownership checks.

There is no automated payment gateway integration. Residents submit payment records and slips for staff verification.

Static Kissmet branding remains in use. The Resident Portal still does not call admin-only settings endpoints.

## Validation

Phase R1/R2/R3/R4/R5/R6/R7 tests cover:

- app rendering
- unauthenticated `/` redirect to `/login`
- authenticated `/` redirect to `/home`
- protected-route redirect when unauthenticated
- valid resident session protected shell
- non-resident session rejection
- `GET /auth/me` session restoration
- `401` session clearing
- logout backend call and redirect
- mobile primary navigation
- desktop navigation
- resident name display
- reusable loading and error states
- currency, date, and status formatter behavior
- public institution loading
- institution and student ID validation
- login OTP request success and failure
- login OTP verification context
- invalid and expired OTP display
- successful login token storage and `/home` redirect
- registration form rendering
- registration required-field validation
- registration OTP request success and failure
- registration OTP verification context
- successful registration token storage and `/home` redirect
- resend behavior for login and registration
- duplicate login submission protection
- missing verification context after refresh
- already-authenticated public auth redirects
- non-resident auth result rejection
- Home page loading, error, retry, and partial failure states
- resident identity dashboard display
- accommodation journey status derivation
- next-action routing for documents, application, booking, payments, and room assignment states
- application and booking summaries using resident-owned records
- resident-safe payment summary behavior
- active allocation display from allocation data only
- no-allocation room pending behavior
- protected Profile route rendering
- Profile identity, institution, student ID, resident code, and contact display
- Profile fallback display for optional contact data
- Profile update through `PATCH /resident/me`
- Profile validation for required names and email shape
- sensitive/internal resident data not displayed
- protected Documents route
- Documents loading, retryable error, empty, one-document, both-document, and rejected states
- Student Card upload success
- Ghana Card upload success
- unsupported file type rejection
- oversized file rejection
- backend upload failure
- duplicate upload submission protection
- upload refresh after success
- no fabricated resident View or Download action
- no R2 object key, storage path, or Ghana Card number display
- Home next-action behavior for missing and partially uploaded documents
- protected Application route
- Application loading and retryable error state
- no-application state
- draft creation against the active session
- generated application number display
- duplicate active application error handling
- no frontend-sent `application_number`, `resident_id`, or staff review fields
- readiness checklist for phone, profile, Student Card, and Ghana Card
- uploaded and verified documents counting as submission-ready
- rejected/missing documents blocking readiness
- submit confirmation
- submit success and failure
- duplicate submit prevention
- lifecycle display for draft, submitted, under_review, approved, rejected, and archived states
- timeline rendering only real timestamps
- approved application not displaying room/payment/allocation completion
- resident-safe rejection reason and fallback behavior
- no admin application API usage
- protected Booking route
- Booking loading and retryable error states
- no-booking messaging before and after application approval
- pending, confirmed, cancelled, expired, completed, and archived booking states
- booking history separation
- captured booking total from `total_amount_minor` and `currency`
- academic session and related application labels
- priced room shown as pricing source, not actual room assignment
- no internal rate IDs, resident IDs, or application IDs displayed
- no frontend recalculation from current room rates
- payment-stage explanation without fake verified totals
- no admin payment API usage
- payment-attention display on confirmed bookings
- allocation shown only from active allocation data
- no resident booking creation action
- protected Payments route
- Payments loading, retryable error, and no-current-booking states
- resident-safe payment summary totals
- part-payment display
- payment creation with backend-generated references
- no frontend-sent `resident_id`, `payment_reference`, status, or staff fields
- payment amount validation and overpayment error handling
- private payment slip upload through authenticated `FormData`
- unsupported and oversized payment slip rejection
- pending payment submission for staff verification
- submitted payment not displayed as verified
- payment status labels for pending, submitted, verified, rejected, refunded, cancelled, and archived states
- payment attention display on confirmed bookings
- resident receipt history display for issued and voided receipts
- no resident issue, void, verify, refund, admin payment, or admin receipt API usage

Latest Phase R7 validation:

- resident-frontend typecheck: passed
- resident-frontend tests: 10 files / 99 tests passed
- resident-frontend build: passed
- cloudflare typecheck: passed
- cloudflare tests: 5 files / 99 tests passed

No D1 migrations were required for Phase R7. Backend code added resident-owned payment summary, payment listing, payment creation, payment submission, private payment slip upload, and receipt read endpoints using the existing payments, receipts, documents, bookings, and payment confirmation settings schema.
