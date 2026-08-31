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
- `/applications`
- `/bookings`
- `/rooms`
- `/allocations`

Prepared placeholder routes:

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

## Bookings

The Bookings interface uses the existing backend APIs:

- `GET /admin/bookings`
- `POST /admin/bookings`
- `GET /admin/bookings/:id`
- `PATCH /admin/bookings/:id/status`
- `GET /admin/bookings/:id/payment-summary`
- `GET /admin/availability`
- `GET /admin/applications`
- `GET /admin/applications/:id`
- `GET /admin/residents/:id`
- `GET /admin/institutions`
- `GET /admin/academic-sessions`
- `GET /admin/rooms`
- `GET /admin/room-rates`

Implemented functionality:

- `/bookings` admin route
- professional Bookings page header with the approved shell and visual system
- current-page summary cards for pending, confirmed, completed, and payment-attention bookings
- server-side search by backend-supported fields: booking number and status
- current-page status and academic-session filters
- paginated bookings table with booking number, resident, application, academic session, priced room, amount, payment progress, status, created date, and view action
- booking detail dialog organized into Booking, Resident, Application, Financial basis, Payment summary, Allocation, and Actions sections
- create-booking workflow for roles with `booking:write`
- confirmation/status actions that expose only valid backend transitions
- payment-summary, create, transition, empty, and API error states

Booking creation:

- Starts from approved applications only.
- Shows resident, institution, and academic session context for the selected application.
- Calls `GET /admin/availability` for eligible rooms with active rates.
- Shows an active room-rate preview before submission.
- Calls `POST /admin/bookings` with `applicationId` and `roomId` only.
- The frontend never generates `KSM-BKG-xxxx`, never submits a booking number, and never calculates or overrides the captured booking total.

Booking lifecycle shown in the UI follows the backend service:

- `pending -> confirmed`
- `pending -> cancelled`
- `pending -> expired`
- `pending -> archived`
- `confirmed -> completed`
- `confirmed -> cancelled`
- `confirmed -> archived`
- `cancelled -> archived`
- `expired -> archived`
- `completed -> archived`

Payment confirmation:

- The detail view uses `GET /admin/bookings/:id/payment-summary`.
- It distinguishes booking total, verified payments, outstanding balance, pending/submitted payment availability, confirmation threshold, and confirmation eligibility.
- The Confirm action is shown only for pending bookings when the role can confirm and the payment summary reports `confirmationRequirementMet = true`.
- Backend confirmation remains authoritative and may still reject the transition.
- Payment attention is displayed from booking/payment-summary state and does not automatically change booking status.

Pricing integrity:

- The UI shows the booking's captured `total_amount_minor`, `currency`, `priced_room_id`, and `priced_room_rate_id`.
- It does not recalculate the booking amount from the current room rate.
- Later room-rate changes therefore do not rewrite or visually replace the booking's historical financial basis.

Allocation boundary:

- Confirming a booking does not allocate a bed.
- Confirmed bookings display placement readiness, but the Bookings page never calls `/admin/allocations`.
- Allocation remains a separate management phase.

RBAC behavior:

- `super_admin`: full access.
- `manager`: booking read/write and confirmation in current backend permissions.
- `reception`: booking read/write in current backend permissions; confirmation is not granted by the current permission map.
- `accounts`: booking read and `booking:confirm` in the current permission map.
- `maintenance`: no booking management actions.
- Backend authorization remains authoritative.

Known backend/API limitations:

- `GET /admin/bookings` returns raw booking rows without joined resident, application, room, or session labels. The UI performs bounded current-page lookups using existing endpoints.
- Booking status and academic-session filters are not server-side filters yet. The UI applies them to the current result page and documents this behavior.
- `GET /admin/bookings/:id/payment-summary` does not expose pending/submitted payment totals. The UI labels that field as unavailable instead of fabricating a value.
- There is no active-allocation summary endpoint scoped by booking yet. Allocation detail is limited to readiness messaging in this phase.

## Rooms & Beds

The Rooms & Beds interface uses the existing backend APIs:

- `GET /admin/rooms`
- `POST /admin/rooms`
- `GET /admin/rooms/:id`
- `PATCH /admin/rooms/:id/status`
- `GET /admin/rooms/:id/beds`
- `POST /admin/beds`
- `PATCH /admin/beds/:id/status`
- `GET /admin/room-rates`
- `POST /admin/room-rates`
- `PATCH /admin/room-rates/:id/status`
- `GET /admin/academic-sessions`
- `GET /admin/dashboard/occupancy`
- `GET /admin/allocations`
- `GET /admin/residents/:id`

Implemented functionality:

- `/rooms` admin route
- professional Rooms & Beds page header with the approved shell and visual system
- dashboard-backed summary cards for rooms, usable beds, occupied beds, and available beds
- search by room code/name plus current-page status and gender-policy filters
- rooms table with room identity, configured capacity, actual usable bed inventory, occupied beds, available beds, gender policy, status, active rate, and actions
- room detail view with Overview, Beds, and Rates tabs
- room creation using backend validation
- room status changes with confirmation
- bed creation by room
- bed status changes for unoccupied beds
- occupied beds show protected messaging and do not offer out-of-service actions when active allocation data is known
- room-rate creation by room and academic session
- room-rate status changes with confirmation
- loading, empty, no-results, API-error, form-error, and confirmation states

Capacity and occupancy rules:

- `rooms.capacity` is shown as the configured maximum capacity only.
- Actual room inventory comes from bed records.
- Occupancy and available-bed counts come from `GET /admin/dashboard/occupancy` where possible.
- The frontend does not reconstruct occupancy from booking status.
- Bed creation is locally blocked when active bed inventory has already reached configured room capacity, and the backend capacity guard remains authoritative.
- Room creation does not implicitly create beds.
- Taking a bed or room out of service stores the backend `maintenance` status.
- A bed or room with an active allocation cannot be moved to `maintenance`, `inactive`, or `archived` by the backend status endpoint.
- Failed room/bed status changes do not alter allocation history.

Room-rate and pricing rules:

- Room-rate amounts are entered in GHS major units such as `2500.00`.
- The frontend converts amounts to integer minor units such as `250000` before calling the backend.
- The conversion is handled by the reusable `parseMoneyToMinorUnits` utility and does not use floating point arithmetic.
- The backend default currency remains `GHS`, and the UI submits the selected currency explicitly.
- One active room rate per room/session is enforced by the backend and surfaced as an API error.
- Rate status changes do not call booking endpoints and do not mutate historical booking totals.

RBAC behavior:

- Users with `admin:read` can view the Rooms & Beds page.
- Users with `admin:write` can create rooms, create beds, create room rates, and perform status changes.
- Roles without `admin:write`, such as `maintenance` in the current permission map, do not see write actions.
- Backend authorization remains authoritative.

Known backend/API limitations:

- There are no general room, bed, or room-rate update endpoints yet; only create and status-change operations are exposed.
- `GET /admin/rooms` and `GET /admin/room-rates` do not provide server-side search/status/gender filters yet. The UI applies those filters to the bounded current result page.
- `GET /admin/rooms/:id/beds` returns bed rows without joined resident/allocation details. The UI combines the existing allocations endpoint with resident lookups for active bed occupancy display.

## Allocations

The Allocations interface uses the existing backend APIs:

- `GET /admin/allocations`
- `POST /admin/allocations`
- `GET /admin/allocations/:id`
- `POST /admin/allocations/:id/transfer`
- `PATCH /admin/allocations/:id/status`
- `GET /admin/bookings`
- `GET /admin/bookings/:id`
- `GET /admin/availability`
- `GET /admin/rooms`
- `GET /admin/rooms/:id/beds`
- `GET /admin/residents/:id`
- `GET /admin/academic-sessions`
- `GET /admin/room-rates`
- `GET /admin/institutions`

Implemented functionality:

- `/allocations` admin route
- scoped summary cards for active allocations, available beds, ready loaded bookings, and transfers
- paginated table with resident, booking, academic session, room/bed, status, assigned date, ended date, and actions
- detail dialog organized into Allocation, Resident, Booking, Placement, History, and Actions sections
- create-allocation workflow for roles with `allocation:write`
- transfer workflow for active allocations
- end, cancel, and archive status actions where the backend status rules allow
- loading, empty, no-results, lookup, create, transfer, status-change, and API error states

Allocation creation:

- Only loaded bookings with `status = confirmed` are offered.
- Confirmed bookings are excluded when the resident already has an active allocation for the same academic session in the loaded allocation set.
- A specific bed is required; the frontend never allocates by room only.
- Available beds come from `GET /admin/availability` for the selected booking session and resident.
- `POST /admin/allocations` submits only `bookingId`, `residentId`, `academicSessionId`, `bedId`, `startsOn`, and optional notes.
- The frontend does not submit or mutate booking totals, priced room IDs, priced rate IDs, room rates, payments, receipts, or booking status.

Placement and pricing rules:

- The backend remains authoritative for confirmed-booking eligibility, room availability, bed availability, duplicate resident allocation, gender policy, session matching, active allocation uniqueness, and pricing compatibility.
- Same-room transfers are offered where backend availability allows them.
- Same-priced cross-room transfers are offered only when the destination active rate amount and currency match the booking's captured financial basis.
- Differently priced destination rooms are hidden where the frontend can determine the mismatch and are still rejected by backend validation.
- The frontend does not implement repricing, refunds, credits, adjustment invoices, or booking-total changes.

Allocation history:

- The detail view includes current-page resident allocation history, including transferred, ended, cancelled, archived, and active rows where loaded.
- History is not collapsed into only the current placement.
- If complete resident-scoped allocation history is needed beyond the loaded page, the backend needs a resident-scoped history endpoint.

Room/bed operational safeguards:

- Actively allocated rooms/beds cannot be taken out of service through room/bed status endpoints.
- Ending or transferring an allocation naturally frees the old bed for later room/bed status operations through the existing APIs.

RBAC behavior:

- `super_admin`: full access.
- `manager`: allocation read/write in the current backend permission map.
- `reception`: allocation read/write in the current backend permission map.
- `accounts`: no allocation management actions in the current backend/frontend permission map.
- `maintenance`: no allocation management actions in the current backend/frontend permission map.
- Backend authorization remains authoritative.

Known backend/API limitations:

- `GET /admin/allocations` returns raw allocation rows without joined resident, booking, room, bed, institution, or session labels. The UI performs bounded current-page lookups using existing endpoints.
- Server-side allocation search currently covers allocation `status` only.
- Resident, booking, room, and academic-session filters are current-page/frontend filters unless backend list filtering is expanded later.
- There is no resident-scoped allocation-history endpoint yet; detail history uses the loaded allocation page.

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
- bookings list rendering
- booking detail dialog
- booking creation from approved applications
- non-approved applications excluded from booking creation
- frontend does not generate booking numbers
- room/rate preview
- captured amount display
- payment-threshold-gated confirmation visibility
- confirmation success and failure
- confirmation does not trigger allocation requests
- payment-attention display
- booking RBAC action visibility
- invalid booking transitions hidden
- booking API and creation error states
- human-readable booking dates
- rooms list rendering
- configured capacity separated from actual bed inventory
- room detail occupancy from active allocations
- room creation without implicit bed creation
- bed capacity guard
- bed creation and safe bed status handling
- room-rate creation with integer minor units
- duplicate active room/session rate error display
- room-rate status changes do not mutate booking pricing
- rooms RBAC write-action visibility
- rooms API error state
- allocations list rendering
- allocation detail dialog
- only confirmed bookings eligible for allocation
- specific destination bed required
- successful allocation without booking financial-basis mutation
- duplicate active resident/session allocation excluded from the eligible booking list
- unavailable/occupied bed filtering through backend availability
- gender and pricing incompatible beds excluded where available data allows
- same-room and same-priced cross-room transfer options
- differently priced cross-room transfer rejection surfaced from the backend
- transferred allocation history remains visible
- end allocation status action
- allocation RBAC action visibility
- allocation API and mutation error states
- human-readable allocation dates
- money parser validation
- currency formatting
- status formatting
- date/time formatting

Latest validation:

```text
admin-frontend: npm.cmd run typecheck passed
admin-frontend: npm.cmd test passed, 10 files / 61 tests
admin-frontend: npm.cmd run build passed
cloudflare: npm.cmd run typecheck passed
cloudflare: npm.cmd test passed, 5 files / 71 tests
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
