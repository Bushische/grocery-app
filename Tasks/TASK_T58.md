# T58 — Telegram: initData validation + link table (no routes yet)
- **Goal:** Trustable Telegram identity primitive: HMAC-validated `initData` plus a persisted Telegram→user link, mirroring the Alice T49 service-first pattern.
- **Inputs:** docs/TELEGRAM_PLAN.md (§1–§2), T3 (Drizzle schema/migrations), `authService.ts` hash-only practice (for contrast: telegram_id is public, stored as-is), `config.ts` prod-required pattern (T34).
- **Outputs:** `telegram_links(user_id PK → users.id CASCADE, telegram_id TEXT UNIQUE, created_at)` + drizzle migration; `apps/api/src/telegram/initData.ts` (`validateTelegramInitData` → `{ telegramId, authDate }`, HMAC `WebAppData` steps + 24 h freshness window, `timingSafeEqual`); `service.ts` (get-by-telegram-id, link/upsert-move, unlink); shared zod DTOs for later routes (initData string, telegramId); unit tests with fixture-token vectors (valid, tampered-user, stale auth_date, missing hash).
- **Definition of Done:** valid vector passes; tampered `user.id` → reject; replay after 24 h → reject; wrong bot token → reject; link move (same telegram_id, new userId) keeps exactly one row; full gate green. No routes yet.
- **Dependencies:** T3.
