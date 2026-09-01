# Resident Frontend

Phase R1 added a separate Resident Portal frontend at `resident-frontend/`.
Phase R2 replaces the auth placeholders with real resident registration and OTP authentication against the existing Cloudflare/Hono backend.

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

Resident auth API wrappers live in `src/api/residentAuth.ts`, and public institution loading lives in `src/api/institutions.ts`.

## Shell And Navigation

The resident shell is mobile-first:

- desktop/tablet header and compact side navigation
- mobile header and bottom navigation
- mobile primary items: Home, Application, Payments, My Room, More
- More menu: Booking, Maintenance, Messages, Announcements, Profile, Documents, Logout

The shell uses a lighter resident visual treatment: light background, white cards, teal accent, larger touch targets, and simple status chips.

## Home Foundation

`/home` is the only real protected page in R1. It shows:

- welcome header using the authenticated resident display name when available
- resident identity area
- neutral next-action placeholder
- neutral placeholder cards for Application, Booking, Payment, and My Room

The page deliberately does not fabricate statuses, amounts, room numbers, booking state, application decisions, or payment progress.

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

R2 completes real login, registration OTP, and session establishment only. The following remain later phases:

- profile editing
- Student Card and Ghana Card uploads
- application workflow
- booking UI
- payments and receipts
- room allocation display
- maintenance requests
- announcements
- resident message inbox

Static Kissmet branding remains in use. The Resident Portal still does not call admin-only settings endpoints.

## Validation

Phase R1/R2 tests cover:

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
- Home page neutral data behavior
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

Latest Phase R2 validation:

- resident-frontend typecheck: passed
- resident-frontend tests: 4 files / 36 tests passed
- resident-frontend build: passed
- cloudflare typecheck: passed
- cloudflare tests: 5 files / 94 tests passed

No backend code changes or D1 migrations were required for Phase R2.
