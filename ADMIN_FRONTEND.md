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

Prepared placeholder routes:

- `/residents`
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
- currency formatting
- status formatting

Latest validation:

```text
admin-frontend: npm.cmd run typecheck passed
admin-frontend: npm.cmd test passed, 4 files / 10 tests
admin-frontend: npm.cmd run build passed
cloudflare: npm.cmd run typecheck passed
cloudflare: npm.cmd test passed, 5 files / 67 tests
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
