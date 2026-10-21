# Plan A changelog

## 2026-10-21
- Added the Phase A0 app-side foundation:
  - `src/lib/settings.ts` for public setting reads and private-key guards
  - `src/lib/admin.ts` for admin checks using `is_admin()`
  - `src/lib/premium.ts` for premium status reads and offline-safe cache support
- Added rollback documentation for the A0 database objects.
- Confirmed that the Supabase-side Phase A0 work is already complete externally; this repo now exposes the client-facing foundation needed to consume those server-side objects safely.

## Notes
- This work is intentionally limited to the shared foundation and does not start Plan B or any premium feature UI.
- Every database change is documented with a matching rollback path.
