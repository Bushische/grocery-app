# T60 — Web Mini App client: auto-login + link form
- **Goal:** Inside Telegram the app opens logged-in; unknown Telegram accounts get a one-time link form. Outside Telegram nothing changes.
- **Inputs:** T59 (session/link endpoints), T14 (`use-session` boot, Zustand in-memory token, api-client single-flight refresh), docs/TELEGRAM_PLAN.md (§2–§3), `telegram-web-app.js` (`window.Telegram.WebApp.initData`, `ready()/expand()`).
- **Outputs:** `apps/web/src/features/telegram/`: `webapp.ts` (guarded `getTelegramInitData()` + ambient types), `api.ts` (session/link calls), `use-telegram-session` hook (initData-session attempted before silent refresh; 404 → link-needed state), login-page link variant (RHF + shared schemas + initData, 404-aware hint, ≥40 px targets); `index.html` script tag (`defer`, CSP-safe); component tests (no-Telegram unchanged, hit auto-auth, miss link form, link success).
- **Definition of Done:** in-Telegram linked → main screen without password; in-Telegram unlinked → link form → success → main screen; desktop browser → today's flow byte-for-byte; `pnpm test && pnpm lint` green.
- **Dependencies:** T59, T14.
