# Admin Portal Foundation

## Scope

Phase 4 adds Cloudflare Workers + Hono + TypeScript admin APIs for foundational hostel administration. It does not use or depend on the legacy Django runtime.

Not included in this phase: applications, bookings, allocations, payments, receipts, resident dashboard, maintenance, announcements, or document uploads.

Application approval for later phases must not automatically allocate a bed. Approval, booking, and bed allocation are separate operational steps.

## Routes

All routes are mounted under `/admin` and require an authenticated session.

- `GET /admin/dashboard`
- `GET /admin/academic-sessions`
- `POST /admin/academic-sessions`
- `GET /admin/academic-sessions/:id`
- `PATCH /admin/academic-sessions/:id/status`
- `GET /admin/institutions`
- `POST /admin/institutions`
- `GET /admin/institutions/:id`
- `PATCH /admin/institutions/:id/status`
- `GET /admin/rooms`
- `POST /admin/rooms`
- `GET /admin/rooms/:id`
- `PATCH /admin/rooms/:id/status`
- `GET /admin/rooms/:roomId/beds`
- `POST /admin/beds`
- `PATCH /admin/beds/:id/status`
- `GET /admin/room-rates`
- `POST /admin/room-rates`
- `PATCH /admin/room-rates/:id/status`
- `GET /admin/residents`
- `POST /admin/residents`
- `GET /admin/residents/:id`
- `GET /admin/staff`
- `POST /admin/staff`
- `GET /admin/staff/:id`
- `PATCH /admin/staff/:id/status`
- `GET /admin/roles`

List endpoints support pagination through `limit` and `offset`; useful lists support basic `search`.

## Permissions

Admin routes use the existing auth middleware:

- `requireAuth`
- `requireRole`
- `requirePermission`

Role behavior:

- `super_admin`: full access.
- `manager`: operational admin access through `admin:read`, `admin:write`, `resident:read`, and `resident:write`.
- `reception`: resident and booking-facing intake permissions, including resident create/read.
- `accounts`: payment permissions only; blocked from foundation admin writes.
- `maintenance`: maintenance permissions only; blocked from foundation admin writes.
- `resident`: self-service resident permission only; blocked from admin routes.

Server-side middleware enforces access. Frontend visibility is not trusted.

## Business Rules

- Only one active academic session is preserved by the D1 partial unique index.
- Activating an academic session closes any previously active session in the service layer before setting the target active.
- Rooms expose configured capacity, active bed count, active occupancy, and availability.
- Bed creation checks current non-archived bed inventory against `rooms.capacity` before inserting.
- Room rates use integer minor units and default currency `GHS`.
- D1 prevents more than one active room rate for the same room/session.
- Resident creation generates `resident_code` in the admin service. Clients never submit or choose it.
- Resident codes use the format `KSM-RES-0001`, `KSM-RES-0002`, and so on.
- The numeric resident-code sequence is stored separately in `resident_code_sequence`, so the public/internal Kissmet code is not the raw D1 primary key.
- Code allocation uses a compare-and-swap update against `resident_code_sequence.next_value`. The existing unique constraint on `residents.resident_code` remains the final guard; an unexpected collision is retried or fails instead of silently producing duplicates.
- Residents are linked to `institutions` and `student_id`.
- D1 enforces one resident per `(institution_id, student_id)`.
- Staff creation hashes initial passwords before storage and returns the initial password only once.

## Validation

Request JSON is parsed and validated before service calls.

- Required strings must be non-empty.
- String length is bounded.
- Integer fields must be real integers.
- Response bodies use consistent shapes:
  - Success: `{ "ok": true, "data": ... }`
  - Lists: `{ "ok": true, "data": [...], "pagination": ... }`
  - Errors: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

## Audit Logging

Administrative create and status-change actions write to `audit_logs`.

Examples:

- `admin.academic_session.create`
- `admin.academic_sessions.status`
- `admin.institution.create`
- `admin.room.create`
- `admin.bed.create`
- `admin.room_rate.create`
- `admin.resident.create`
- `admin.staff.create`
- `admin.staff.status`

## Test Results

Latest local validation:

```text
npm.cmd run typecheck
tsc --noEmit passed

npm.cmd test
2 test files passed
27 tests passed
```

Covered Phase 4 cases:

- insufficient role
- authorized role
- create academic session
- activate/status-change academic session
- create institution
- create room
- create multiple beds
- reject bed creation beyond capacity
- create room rate
- reject duplicate active room/session rate
- create resident
- auto-generated resident code
- reject duplicate institution + student ID
- create staff member and assign role
- deactivate staff
- dashboard summary counts

The existing authentication tests still cover unauthorized route access through `requireAuth`.
