# T59 — Telegram: session/link/unlink auth routes
- **Goal:** One-tap Telegram login: linked devices get JWTs from `initData` alone; first-timers link with email+password once.
- **Inputs:** T58 (validation + service), T5 (`authService.authenticate`, refresh rotation + cookie contract to reuse), docs/TELEGRAM_PLAN.md (§2), `plugins/auth.ts` (`signAccessToken`).
- **Outputs:** `apps/api/src/telegram/routes.ts`: `POST /auth/telegram/session { initData }` → 200 `loginResponse` + refresh cookie on hit, 404 `TELEGRAM_NOT_LINKED` on miss; `POST /auth/telegram/link { email, password, initData }` → 200 same shape (bcrypt check, timing-safe 401, then link-move + session); `DELETE /auth/telegram/link` (requireAuth) → 204; config `TELEGRAM_BOT_TOKEN` (+ max-age default 86400, prod-required boot check) + `.env.example`; one-line registration in `app.ts`; inject tests.
- **Definition of Done:** hit → session without password; miss → 404 (no session, no cookie); link → subsequent session hits; bad signature/stale → 401; wrong password → 401, no link row; unlink → next session 404; Alice OAuth + password login untouched; full gate green.
- **Dependencies:** T58, T5.
