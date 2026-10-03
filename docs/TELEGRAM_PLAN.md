# Telegram integration — plan (DRAFT for review)

Goal: run the existing grocery web app inside Telegram as a Mini App, with one-tap
login for returning users. Alice integration keeps working as-is; the same internal
user can be linked to an Alice OAuth identity AND a Telegram id at the same time
(two independent link tables, no shared state).

> Status: investigation done, no code written. This document is for review. After
> approval, implementation is split into per-task files (`Tasks/TASK_Txx.md`), one
> task per phase below.
> Official docs: https://core.telegram.org/bots/webapps (+
> https://docs.telegram-mini-apps.com/platform/init-data for validation).

## 1. How Telegram talks to us (protocol summary)

- The Mini App is the SAME Vite build served by nginx, opened inside Telegram via a
  BotFather Menu Button / `/newapp` URL `https://grocery.<domain>/` (existing
  Cloudflare Tunnel, HTTPS required by Telegram, no new infra). Add
  `<script src="https://telegram.org/js/telegram-web-app.js">` + `Telegram.WebApp.ready()`.
- On launch Telegram injects `window.Telegram.WebApp.initData: string` — a raw
  URL-encoded query string (`auth_date`, `user` JSON, `query_id?`, `hash`). It is
  cryptographically signed with the bot token; `initDataUnsafe` is attacker
  controlled and must NEVER drive auth decisions.
- Validation (server side, every call that touches identity):
  1. `params = new URLSearchParams(initData)`, take out `hash`, remember it.
  2. Sort remaining `key=value` lines alphabetically, join with `\n` → `checkString`.
  3. `secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)` (raw bytes, not hex).
  4. `calc = hex(HMAC_SHA256(key=secret, msg=checkString))`.
  5. Constant-time compare (`timingSafeEqual`) with `hash`; reject on mismatch.
  6. Enforce freshness: `now - auth_date <= 24h` (else 401 → client re-reads
     `initData` and retries once; a stolen string is only useful for a day).
- Identity = verified `user.id` (Telegram numeric id, store as TEXT). Everything
  else (lists, prices) is re-derived server-side; the client sends intent only.

## 2. Account linking design (Telegram user ↔ our email user)

The user's recommended hybrid approach, confirmed by investigation — link once
with password, then passwordless:

1. First launch in Telegram: web client reads `initData`, calls
   `POST /auth/telegram/session { initData }`.
2. Backend validates signature + freshness → looks up `telegram_links.telegram_id`.
   - Hit → issue standard session: 15-min JWT `accessToken` (body) + 30-day
     refresh cookie (same `REFRESH_COOKIE_*` contract as `/auth/login`, rotated).
     Client stores the JWT in memory (existing Zustand store) — no password typed.
   - Miss (404 `TELEGRAM_NOT_LINKED`) → client shows the normal login form with
     an additional "Link this Telegram account" note, submits
     `POST /auth/telegram/link { email, password, initData }`.
3. Link endpoint: validates `initData` (signature + freshness), verifies
   email/password via existing `authService.authenticate` (bcrypt, same 401
   message so emails are not enumerable), then upserts
   `telegram_links(user_id PK → telegram_id UNIQUE, created_at)` and issues the
   standard session (same JWT + refresh cookie as login).
4. All later launches use step 2 (hit path). If the user changes Telegram account
   or the link row is deleted, the next launch returns 404 again → re-link.
5. Coexistence with Alice: `alice_links(userId→listId)` and OAuth tables are
   untouched; `telegram_links` is a separate table keyed by `users.id`, so one
   email user can hold both links simultaneously. No change to `/users`,
   `/api-tokens`, OAuth, or Alice webhook behavior.

Security notes:
- `TELEGRAM_BOT_TOKEN` from `.env` (never committed, `.env.example` placeholder);
  production boot fails fast when empty (same pattern as `JWT_SECRET`/`CORS_ORIGIN`).
- Hash nothing here: `telegram_id` is Telegram's public identifier, stored as-is
  (unlike `glc_` tokens / OAuth secrets which stay sha256-hashed).
- One Telegram id → at most one user (`UNIQUE(telegram_id)`); re-linking the same
  Telegram id to a different email MOVES the link (explicit, tested) — no silent
  duplicates. Optional `DELETE /auth/telegram/link` (requires `requireAuth`)
  removes the caller's link (revoke/unlink).
- Rate-limit note: login/link endpoints reuse the existing timing-equalized
  `authenticate`; no new captcha in v1 (same posture as Alice webview login).

## 3. What we must support (checklist)

**Backend (new, isolated like `src/alice/` + `src/oauth/`):**
- [ ] `telegram_links` table (Drizzle migration): `user_id PK → users.id CASCADE`,
      `telegram_id TEXT NOT NULL UNIQUE`, `created_at`.
- [ ] `apps/api/src/telegram/initData.ts` — `validateTelegramInitData(initData,
      botToken)` → `{ telegramId, authDate }` or throws 401-coded error
      (bad signature / stale / malformed); pure function, unit-tested with
      vectors generated from a fixture bot token (HMAC steps above).
- [ ] `apps/api/src/telegram/service.ts` — `getLinkByTelegramId`,
      `linkTelegramAccount(db, userId, telegramId)` (upsert/move), `unlink`.
- [ ] `apps/api/src/telegram/routes.ts`:
      `POST /auth/telegram/session { initData }` → 200 `loginResponse` shape
      (accessToken + user, refresh cookie set) or 404 `TELEGRAM_NOT_LINKED`;
      `POST /auth/telegram/link { email, password, initData }` → 200 same shape
      or 401; `DELETE /auth/telegram/link` (auth) → 204. Zod schemas in
      `packages/shared` (telegram DTOs only — no change to existing auth schemas).
- [ ] Config: `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_AUTH_MAX_AGE_SECONDS` default 86400),
      required-in-production check, `.env.example` entries.

**Frontend (Mini App shell, existing routes unchanged):**
- [ ] `apps/web/src/features/telegram/` — second dedicated folder (mirrors the
      Alice rule "one folder per integration"): `webapp.ts` (`getTelegramInitData()`
      — `window.Telegram?.WebApp?.initData ?? null`, typed via ambient declaration),
      `api.ts` (`sessionWithTelegram`, `linkWithTelegram`), `hooks/`, `components/`.
- [ ] Boot: if `initData` present, try session-with-Telegram BEFORE the silent
      `/auth/refresh` (Telegram WebView keeps cookies, so refresh still works as
      fallback; ordering avoids a wasted failing refresh on fresh devices).
- [ ] Unlinked state → login page gains a "Link Telegram" variant (same RHF +
      shared schema email/password fields, plus hidden initData; 404-aware hint
      text; ≥40 px targets; mobile-first as today).
- [ ] `Telegram.WebApp.ready()` + `expand()` on boot when inside Telegram;
      outside Telegram (plain browser) the app behaves exactly as today
      (no initData → no Telegram calls). No PWA/SW changes.
- [ ] Tests: initData-missing → normal flow; session-hit → authenticated without
      password; session-miss → link form; link success → session set.

**Bot/ops (manual, not code):**
- [ ] BotFather: create bot → token → `.env` on deploy; `/setdomain` +
      Menu Button / `/newapp` URL = `https://grocery.<domain>/`; enable inline?
      No — Mini App only. Test on a real phone (link → kill → reopen = no
      password; Alice voice still works for the same user).

**Explicitly out of v1:** Telegram Bot API messaging (notifications, inline
buttons, `answerWebAppQuery`); per-list binding for Telegram (unlike Alice's
single-list `alice_links` — Telegram gets the FULL app with list switcher, so no
binding table); Admin UI for links (inspect via DB); third-party Ed25519
validation (bot-token HMAC is sufficient — we own the bot).

## 4. Folder layout (all Telegram code isolated)

- `apps/api/src/telegram/` — EVERYTHING server-side in one folder:
  `initData.ts` (validation, pure), `service.ts` (link CRUD),
  `routes.ts` (session/link/unlink, thin like other `routes/`),
  `*.test.ts` next to each. Only touch outside: one-line registration in
  `app.ts`, new table in `db/schema.ts` + migration, shared zod DTOs in
  `packages/shared`, config entries in `config.ts` + `.env.example`.
- `apps/web/src/features/telegram/` — Mini App client side only:
  `webapp.ts`, `api.ts`, `hooks/use-telegram-session.ts`,
  `components/telegram-link-form.tsx` (or login-page extension), tests.
  No changes to list/item/category/member/user features.
- No changes to `apps/api/src/alice/`, `src/oauth/`, or Alice docs.

## 5. Implementation phases (one `Tasks/TASK_Txx` each after this plan is approved)

- **T-B1 — Telegram validation + link table:** `telegram_links` schema +
  migration, `initData.ts` HMAC validation + freshness window, `service.ts`
  link/unlink, unit tests with fixture vectors. No routes yet.
- **T-B2 — Telegram auth routes:** session/link/unlink endpoints + shared zod
  schemas + config (bot token, max-age, prod-required check) + inject tests
  (hit/miss/link/move/unlink/bad-signature/stale).
- **T-B3 — Web Mini App client:** `features/telegram/` (detect, auto-session,
  link-form variant, `ready()/expand()`), boot ordering with `use-session`,
  component tests. Outside-Telegram behavior unchanged.
- **T-B4 — Bot setup + live verification:** BotFather record, domain/menu-button
  URL, phone pass (fresh link → reopen = no password → unlink → relink;
  Alice voice for the same user still works), tunnel latency check. Code only
  for fixes the pass uncovers.

## 6. Risks / open questions for review

1. Refresh cookie inside Telegram WebView: `Secure + SameSite=Strict + Path=/api/auth`
   over same-origin nginx proxy should persist — but some Telegram clients clear
   WebView storage aggressively. Mitigation: session-with-Telegram is tried FIRST
   on every boot, so even a dropped cookie only costs one extra POST, never a
   password prompt. The live pass (T-B4) must verify on Android + iOS.
2. `telegram.org/js/telegram-web-app.js` is an external CDN script — CSP (`helmet`)
   must allow it, and offline/PWA shell must not break when it is unreachable.
   (v1: plain `<script>` in `index.html`, `defer`, guarded `window.Telegram?.`.)
3. ~~Link-move semantics: same Telegram id linking a SECOND email moves the link
   (chosen for simplicity — one device, one account). Alternative is 409
   "already linked" — confirm desired UX before T-B2.~~ RESOLVED: re-assign by
   default — linking a Telegram id that is already linked to another user MOVES
   the link to the newly authenticated user (less confronting, no 409 dead-end;
   the previous user simply gets `TELEGRAM_NOT_LINKED` on next launch and can
   re-link).
4. No `query_id`/`answerWebAppQuery` usage in v1 — if push confirmations are
   wanted later, they become a T-B5.
