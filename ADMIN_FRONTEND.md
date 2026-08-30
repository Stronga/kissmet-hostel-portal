# Kissmet Admin Frontend

## Stack

Phase 9 adds the Admin Portal frontend foundation using React, TypeScript, Vite, React Router, Tailwind CSS, and Vitest. The Hono Worker API remains the backend source of truth.

The frontend lives in:

```text
admin-frontend/
```

## Project Structure

```text
admin-frontend/src/
  api/          typed API client modules
  auth/         session provider and auth state
  components/   layout, common, and dashboard components
  hooks/        data-loading hooks
  pages/        Login, Dashboard, and placeholders
  routes/       protected route tree
  styles/       Tailwind entry and design tokens
  types/        shared API response types
  utils/        formatters and status mappings
```

## Environment

The API base URL is configured through:

```text
VITE_API_BASE_URL
```

Example:

```text
VITE_API_BASE_URL=http://localhost:8787
```

Production can point this to `https://api.kissmetgroup.org` without changing components.

## Authentication

The login page calls:

```text
POST /auth/staff/login
```

After login, the returned session token is stored for the admin frontend and sent as:

```text
Authorization: Bearer <token>
```

The auth provider then calls:

```text
GET /auth/me
```

Protected pages require an authenticated session. A `401` response clears frontend auth state so the user can sign in again. Logout calls:

```text
POST /auth/logout
```

No separate authentication model was added.

## API Client

Raw `fetch()` calls are centralized in `src/api/client.ts`.

The client handles:

- API base URL
- Authorization header
- JSON parsing
- HTTP errors
- unauthorized session clearing

Dashboard endpoint wrappers live in `src/api/dashboard.ts`.

## Routes

Implemented routes:

- `/login`
- `/dashboard`
- `/residents`

Prepared placeholder routes:

- `/applications`
- `/bookings`
- `/rooms`
- `/allocations`
- `/payments`
- `/receipts`
- `/maintenance`
- `/announcements`
- `/reports`
- `/staff`
- `/audit-logs`
- `/settings`

Placeholders intentionally do not fake CRUD behavior.

## Layout

The admin shell includes:

- desktop sidebar
- mobile/tablet navigation drawer
- topbar
- current staff identity
- role display
- avatar placeholder
- logout control
- reserved notification button
- page header pattern

Navigation is permission-aware where practical, but backend RBAC remains authoritative.

## Dashboard

The dashboard uses real backend endpoints:

- `GET /admin/dashboard/overview`
- `GET /admin/dashboard/occupancy`
- `GET /admin/dashboard/finance`
- `GET /admin/dashboard/applications`
- `GET /admin/dashboard/maintenance`

It displays:

- resident, applicant, bed, occupancy, booking, and maintenance summary cards
- occupancy percentage indicator
- room occupancy table
- financial summary cards
- application/booking counts
- maintenance counts

Money is formatted centrally from integer minor units. For example, `350000` displays as `GHS 3,500.00`.

## Residents

The Residents interface uses the existing backend APIs:

- `GET /admin/residents`
- `POST /admin/residents`
- `GET /admin/residents/:id`
- `GET /admin/institutions`

Implemented functionality:

- professional residents page header
- current-page resident summary cards
- server-side search by the fields supported by the backend repository: resident code, first name, last name, and student ID
- status filter applied to the current result page
- paginated residents table
- resident code, name, student ID, institution, phone availability, status, and view action columns
- resident detail dialog organized into personal, Kissmet, institution/student, contact, application, booking, allocation, and document sections
- Add Resident action for roles with `resident:write`
- backend-backed resident creation form
- frontend never submits or generates `resident_code`
- private identity-document files are not exposed; Ghana Card access remains controlled by backend document routes and permissions

Known backend/API limitations:

- `GET /admin/residents` currently returns raw resident rows and does not join `users`, so phone/email are not exposed in the resident listing or detail.
- Resident status and institution filters are not server-side filters yet. The UI applies status filtering to the current page and documents this behavior.
- Resident detail does not yet have a single aggregate endpoint for applications, bookings, current allocation, or documents. Those sections remain informational until a later backend or frontend phase wires the relevant domain pages/endpoints.
- No resident update or delete endpoint exists. The UI does not add deletion or unsupported status changes.

## Applications

The Applications interface uses the existing backend APIs:

- `GET /admin/applications`
- `GET /admin/applications/:id`
- `PATCH /admin/applications/:id/status`
- `GET /admin/residents/:id`
- `GET /admin/institutions`
- `GET /admin/academic-sessions`
- `GET /admin/documents`

Implemented functionality:

- `/applications` admin route
- professional Applications page header with the approved shell and visual system
- current-page summary cards for total, submitted, under-review, and approved applications
- server-side search by backend-supported fields: application number and status
- current-page status and academic-session filters
- paginated table with application number, applicant, student ID, institution, academic session, status, submitted date, and view action
- detail dialog organized into Application, Applicant, Review, Documents, Booking, and Actions sections
- workflow actions driven by backend status transitions only
- decision notes submitted with review transitions where the backend accepts them
- loading, empty, no-result, API-error, and transition-error states
- centralized concise timestamp formatting for application list/detail timestamps

Application lifecycle shown in the UI follows the backend service:

- `draft -> submitted`
- `draft -> cancelled`
- `draft -> archived`
- `submitted -> under_review`
- `submitted -> cancelled`
- `under_review -> approved`
- `under_review -> rejected`
- `approved -> archived`
- `rejected -> archived`
- `cancelled -> archived`

Business rule preserved:

- Approving an application only makes the applicant eligible for the booking workflow.
- The frontend does not call `/admin/bookings` or `/admin/allocations` from the approval action.
- Approval does not create a booking, confirm a booking, allocate a room/bed, or alter payment state.

RBAC behavior:

- Users with `application:read` can list and view applications.
- Users with `application:write` can see and use status-transition actions.
- Roles without `application:write`, such as `accounts`, can review application details but cannot change application status.
- Backend authorization remains authoritative.

Document handling:

- The current admin document API exposes identity-document metadata for Student Card and Ghana Card records.
- The frontend displays metadata only and does not expose public R2 URLs.
- Ghana Card content is not fetched by this page; content access remains behind the backend's narrower `document:ghana_card` permission.

Application-number rule:

- Application numbers are generated by the backend from `application_number_sequence`.
- The format is `KSM-APP-0001`, `KSM-APP-0002`, and so on.
- The Applications frontend does not expose admin-side application creation or generate application numbers.

Known backend/API limitations:

- `GET /admin/applications` returns raw application rows without joined resident, institution, or academic-session names. The UI performs bounded current-page lookups using existing resident and reference endpoints.
- Application status and academic-session filters are not server-side filters yet. The UI applies them to the current result page and documents this behavior.
- There is no application-scoped document endpoint yet. The page uses the existing identity-document metadata endpoint and filters by the selected resident.

## Design System

Design tokens are defined as CSS variables in `src/styles/index.css` and mapped into Tailwind:

- background
- surface
- border
- primary
- muted
- success
- warning
- danger
- text-primary
- text-secondary
- radius
- shadows
- spacing

The visual style is compact, professional, data-focused, and intended to be easy to rebrand.

## Testing

Frontend tests cover:

- login success
- login failure
- protected-route redirect
- authenticated route rendering
- logout
- dashboard loading
- dashboard success
- dashboard error state
- residents list rendering
- resident detail dialog
- resident server-side search request
- Add Resident RBAC visibility
- resident creation without frontend-generated resident code
- residents API error state
- applications list rendering
- application detail dialog
- human-readable application timestamps
- reusable date/time formatter
- submitted-to-under-review transition
- under-review approval
- under-review rejection with decision notes
- invalid application actions hidden by state
- approval does not trigger booking or allocation requests
- application action RBAC visibility
- applications server-side search request
- applications API error and transition failure states
- frontend does not expose application creation or generated-number input
- currency formatting
- status formatting
- date/time formatting

Latest validation:

```text
admin-frontend: npm.cmd run typecheck passed
admin-frontend: npm.cmd test passed, 6 files / 29 tests
admin-frontend: npm.cmd run build passed
cloudflare: npm.cmd run typecheck passed
cloudflare: npm.cmd test passed, 5 files / 68 tests
```

## Running Locally

Backend:

```text
cd cloudflare
npm.cmd run dev
```

Frontend:

```text
cd admin-frontend
npm.cmd run dev
```

Open the Vite URL shown in the terminal. By default, the frontend expects the API at `http://localhost:8787`.
