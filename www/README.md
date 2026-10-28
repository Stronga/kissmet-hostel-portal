# Kissmet Group marketing site (`www`)

Static under-construction / coming-soon page intended for the apex domain
**kissmetgroup.org** (and optionally `www.kissmetgroup.org`) via Cloudflare Pages.

## Contents

- `index.html` — single landing page (no JavaScript)
- `styles.css` — dark premium theme using the brand palette
- `assets/` — web-optimized logo + hostel sketch (WebP with JPEG fallbacks)
- `assets/originals/` — full-resolution source images (gitignored; keep locally)
- `_headers` — Cloudflare Pages security headers (CSP with `script-src 'none'`)

## Local preview

From this directory:

```bash
python3 -m http.server 8787
```

Then open http://127.0.0.1:8787/

## Deploy status

**Not deployed.** Publishing this folder to Cloudflare Pages (and pointing
`kissmetgroup.org` DNS at it) requires explicit authorization. Do not push or
deploy from this folder without that approval.

Admin and resident apps remain at `admin.kissmetgroup.org` and
`portal.kissmetgroup.org`; they are intentionally not linked from this page.
