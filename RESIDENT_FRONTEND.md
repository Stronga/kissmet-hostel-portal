# Resident Frontend

Phase R1 adds a separate Resident Portal frontend at `resident-frontend/`.

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

## Authentication Foundation

Phase R1 implements resident session plumbing only.

- Session token storage key: `kissmet_resident_token`
- Token storage is intentionally separate from Admin's `kissmet_admin_token`.
- Session restore calls `GET /auth/me`.
- Logout calls `POST /auth/logout`, clears local state, and redirects to `/login`.
- `401` API responses clear resident auth state.
- `/auth/me` must return `userType = resident`, `role = resident`, and a non-null `residentId`.
- Staff/admin sessions are rejected safely and are not treated as resident sessions.

Resident OTP login remains institution + student ID + OTP, but full OTP request/verification screens are placeholders for the next resident phase.

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

R1 does not add:

- admin routes
- staff controls
- audit log or report access
- settings mutation
- arbitrary resident ID access
- document public URLs
- OTP/session/password hash exposure

Student Card and Ghana Card files remain private R2 objects and require backend-mediated access in later phases.

## Validation

Phase R1 tests cover:

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

Latest Phase R1 validation:

- resident-frontend typecheck: passed
- resident-frontend tests: 3 files / 19 tests passed
- resident-frontend build: passed
- cloudflare typecheck: passed
- cloudflare tests: 5 files / 94 tests passed

No backend code changes or D1 migrations were required for Phase R1.
