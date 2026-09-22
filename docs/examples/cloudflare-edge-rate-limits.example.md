# Cloudflare Edge Rate Limiting — Example Rules (NOT ACTIVE)

**Status:** PRODUCTION DASHBOARD ACTION REQUIRED  
These rules are documentation only. They are **not** applied by this repository.
Do not claim distributed/edge rate limiting is active until verified in the Cloudflare dashboard.

## Recommended (small hostel, proportionate)

| Rule | Path / match | Threshold (starting point) | Action |
| --- | --- | --- | --- |
| Staff login | `api.kissmetgroup.org/auth/staff/login` | 10 req / 1 min / IP | Block / Managed Challenge |
| Resident OTP request | `.../auth/resident/request-otp` | 5 req / 1 min / IP | Block / Challenge |
| Resident OTP verify | `.../auth/resident/verify-otp` | 20 req / 1 min / IP | Block / Challenge |
| Admin API writes | `api.kissmetgroup.org/admin/*` + POST/PATCH/DELETE | 60 req / 1 min / IP | Challenge |
| Oversized body | Zone WAF | > 6 MiB | Block |

## Notes

- App-level isolate Map + D1 OTP/staff counters remain in the Worker; they are **not** edge-global.
- Prefer challenge over permanent IP ban for shared campus NAT.
- Combine with Bot Fight Mode / managed rules as appropriate for a small hostel (see Phase 2 audit).
