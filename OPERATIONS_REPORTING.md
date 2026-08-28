# Kissmet Phase 8 Operations And Reporting

## Scope

Phase 8 completes the remaining backend-only operational layer for the Cloudflare-native Kissmet Hostel portal. It adds maintenance request workflows, announcements, dashboard/reporting summaries, occupancy/financial/application/booking/maintenance reports, and restricted audit-log visibility.

No visual frontend, payment gateway, notifications, multi-hostel support, or legacy Django dependency was added.

## Maintenance

Maintenance requests use `maintenance_requests` and the new `maintenance_request_sequence` table.

- Request numbers are system-generated as `KSM-MNT-0001`, `KSM-MNT-0002`, and so on.
- The D1 primary key remains separate from the request number.
- Resident-created requests are linked to the resident and, when available, their active allocation's room and bed.
- Staff-created requests may optionally target a resident, room, and bed.
- Lifecycle timestamps are `opened_at`, `assigned_at`, `started_at`, `resolved_at`, `closed_at`, and `archived_at`.

Valid transitions:

- `open -> assigned`
- `open -> cancelled`
- `assigned -> in_progress`
- `assigned -> cancelled`
- `in_progress -> resolved`
- `in_progress -> cancelled`
- `resolved -> closed`
- `resolved -> in_progress`
- `closed -> archived`
- `cancelled -> archived`

## Announcements

Announcements use the existing `announcements` table.

- Audience values are `all`, `residents`, and `staff`.
- Status values are `draft`, `published`, `expired`, and `archived`.
- Resident visibility is limited to published, non-expired announcements with audience `all` or `residents`.

Valid transitions:

- `draft -> published`
- `draft -> archived`
- `published -> expired`
- `published -> archived`
- `expired -> archived`

## Routes

Resident routes:

- `GET /resident/me/maintenance`
- `POST /resident/me/maintenance`
- `GET /resident/me/maintenance/:id`
- `GET /resident/me/announcements`
- `GET /resident/me/announcements/:id`

Admin routes:

- `GET /admin/dashboard/overview`
- `GET /admin/dashboard/occupancy`
- `GET /admin/dashboard/finance`
- `GET /admin/dashboard/applications`
- `GET /admin/dashboard/maintenance`
- `GET /admin/maintenance`
- `GET /admin/maintenance/:id`
- `POST /admin/maintenance`
- `POST /admin/maintenance/:id/assign`
- `POST /admin/maintenance/:id/start`
- `POST /admin/maintenance/:id/resolve`
- `POST /admin/maintenance/:id/close`
- `POST /admin/maintenance/:id/cancel`
- `GET /admin/announcements`
- `POST /admin/announcements`
- `GET /admin/announcements/:id`
- `PATCH /admin/announcements/:id`
- `POST /admin/announcements/:id/publish`
- `POST /admin/announcements/:id/archive`
- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`

## Permissions

All admin routes require the existing session authentication middleware.

- `super_admin`: full access through wildcard permission.
- `manager`: operational management, payment/receipt/document management, maintenance assignment/lifecycle, announcements, and audit-log visibility.
- `reception`: resident/application/booking/allocation support, document support, maintenance intake/assignment, and announcement read access.
- `accounts`: payment and receipt responsibilities only.
- `maintenance`: maintenance read/update/resolve responsibilities.
- `resident`: resident portal routes only.

Authorization is enforced server-side through reusable permission middleware. Frontend visibility is not a security boundary.

## Reports

Dashboard overview includes residents, applicants, active residents, rooms, active beds, occupied beds, available beds, occupancy percentage, application counts, booking counts, open/urgent maintenance, published announcements, active academic session, and active staff count.

Occupancy reporting returns:

- total usable beds
- occupied beds
- available beds
- occupancy percentage
- per-room configured capacity, active bed count, occupied bed count, gender policy, status, and active rate

Financial reporting returns:

- expected booking revenue from pending/confirmed/completed bookings
- verified payment totals
- outstanding booking balances
- pending/submitted payment totals
- refunded totals
- fully paid, partially paid, and unpaid booking counts
- bookings requiring payment attention

Application and booking reporting returns counts by status, optionally scoped to an academic session.

Maintenance reporting returns counts for open, assigned, in-progress, resolved, closed, and urgent non-final requests.

## Audit Logging

Administrative create/update/status-change actions write to `audit_logs`. Resident maintenance creation also writes an audit event.

Audit-log visibility is restricted with `audit:read`; currently this is granted to `super_admin` and `manager`.

Audit-log list supports filters for action, entity type, actor user id, and date range. Reading audit logs records `admin.audit_logs.accessed`.

## Validation And Tests

Phase 8 automated tests cover:

- resident maintenance creation/listing/ownership restrictions
- resident announcement visibility restrictions
- maintenance request number generation
- assignment and lifecycle transitions
- invalid maintenance transitions
- role-restricted maintenance assignment
- announcement creation/update/publishing
- invalid announcement transitions
- occupancy, financial, application/booking, and maintenance reports
- restricted audit-log access

Local validation results:

- `npm.cmd run typecheck`: passed
- `npm.cmd test`: 5 test files passed, 62 tests passed
- `npm.cmd run db:migrations:apply:local`: applied `0007_operations_reporting.sql`
- `npm.cmd run db:verify:local`: passed, 43 SQL commands executed successfully
