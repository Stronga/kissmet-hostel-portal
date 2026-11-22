# Frontend performance (2026-11-22)

## Admin bundle

Route-level `React.lazy` / `Suspense` was added in `admin-frontend/src/routes/AppRoutes.tsx`. Vite `manualChunks` split `react` (react, react-dom, scheduler) and `router` (react-router) out of the page graph. Login stays eagerly loaded.

Before: a single `index-*.js` of 604,991 bytes (151 kB gzip).

After `npm run build` on this branch:

- `index-*.js` 28.65 kB (8.44 kB gzip) — app shell + login
- `react-*.js` 193.69 kB (60.49 kB gzip)
- `router-*.js` 38.68 kB (13.96 kB gzip)
- route chunks 6–44 kB each (2–10 kB gzip)

First-load JavaScript (index + react + router) is 261 kB raw / 83 kB gzip, versus 605 kB / 151 kB previously. Dashboard then loads a further 6.21 kB (1.96 kB gzip) route chunk.

## Resident images

Source PNGs were resized and re-encoded offline (no new npm dependencies) with an AVIF/WebP `<picture>` (or equivalent) plus an optimized PNG fallback.

| Asset | Before (PNG) | After AVIF | After WebP | After PNG |
|---|---:|---:|---:|---:|
| hostel-illustration | 2,365,403 (1672×941) | 106,664 | 192,692 | 202,096 (1100×619) |
| hostel-dashboard | 2,151,711 (1671×941) | 92,729 | 178,126 | 190,695 (1100×619) |
| kissmet-logo | 458,746 (947×720) | 12,405 | 25,774 | 16,746 (316×240) |
| kissmet-sidebar-logo | 445,155 (791×541) | 9,868 | 18,298 | 13,209 (234×160) |

Login and register heroes use `loading="eager"` and `fetchpriority="high"` with explicit width/height. Vite dependency versions were not changed in this PR.
