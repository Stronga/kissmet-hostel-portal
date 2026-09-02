# Resident Frontend

Phase R1 added a separate Resident Portal frontend at `resident-frontend/`.
Phase R2 replaces the auth placeholders with real resident registration and OTP authentication against the existing Cloudflare/Hono backend.
Phase R3 replaces the neutral Home and Profile placeholders with real resident-owned dashboard and profile views.

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

The profile request is required for the dashboard to render. Documents, applications, bookings, and allocation are loaded independently so partial failures show a warning without hiding the resident identity and available sections.

The dashboard shows:

- resident identity summary: name, resident code, institution, student ID, phone, email, and status
- next-action card derived from real journey state
- accommodation journey stages: account, documents, application, booking, payment, and room assignment
- latest application summary from resident application records
- latest booking summary from resident booking records
- limited payment summary derived from booking status and total amount only
- active room assignment only from `GET /resident/me/allocation`

Room assignment never comes from application, booking, or payment records. A room is shown only when the backend reports an active allocation.

Resident-safe verified payment totals are not exposed by the current backend. The dashboard does not call admin payment APIs and does not fabricate verified-payment progress. It displays the captured booking amount and marks verified payment totals as unavailable until a resident-safe payment summary endpoint exists.

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

Auth errors are mapped to resident-safe messages. The UI does not expose SQL errors, stack traces, OTP hashes, session-token hashes, registration payload internals, or staff auth state.

## Known Limitations

R3 completes the Home dashboard and Profile display/editing foundation. The following remain later phases:

- Student Card and Ghana Card uploads
- application workflow
- booking UI
- payments and receipts
- maintenance requests
- announcements
- resident message inbox

Profile phone, institution, and student ID self-service changes are not implemented because the backend does not currently expose those operations for residents.

Resident-safe verified payment totals remain unavailable. The dashboard intentionally avoids admin payment APIs and only shows booking-owned totals until a resident-safe endpoint is added.

Static Kissmet branding remains in use. The Resident Portal still does not call admin-only settings endpoints.

## Validation

Phase R1/R2/R3 tests cover:

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
- payment summary behavior without a resident-safe verified-payment endpoint
- active allocation display from allocation data only
- no-allocation room pending behavior
- protected Profile route rendering
- Profile identity, institution, student ID, resident code, and contact display
- Profile fallback display for optional contact data
- Profile update through `PATCH /resident/me`
- Profile validation for required names and email shape
- sensitive/internal resident data not displayed

Latest Phase R3 validation:

- resident-frontend typecheck: passed
- resident-frontend tests: 6 files / 53 tests passed
- resident-frontend build: passed
- cloudflare typecheck: passed
- cloudflare tests: 5 files / 94 tests passed

No backend code changes or D1 migrations were required for Phase R3.
