# T54 — Unblock OAuth authorize page from PWA navigation fallback
- **Goal:** Account linking works in browsers with the PWA installed: `GET /oauth/authorize` serves the consent form, never the app shell.
- **Inputs:** `apps/web/src/lib/pwa-config.ts` (`navigateFallbackDenylist`), `apps/web/src/lib/pwa-config.test.ts` (shell DoD), `apps/api/src/oauth/routes.ts` (consent page), `apps/web/nginx.conf` (`/oauth/` proxy), `docs/ALICE_CONSOLE_SETUP.md` (§2–§3).
- **Outputs:** `pwaWorkbox.navigateFallbackDenylist` gains `/^\/oauth\//` (+ comment update); extended shell test pinning `/oauth/authorize?...` denied while `/`, `/items/i1`, `/lists/l1` still fall back; rebuilt `grocery-web` image.
- **Definition of Done:** `denied("/oauth/authorize?scope=alice...") === true`, existing allow/deny pins unchanged; `pnpm test && pnpm lint` green; manual: with SW installed, `GET /oauth/authorize?...` returns `text/html` consent (Network shows no `/assets/*`, no `/api/auth/refresh`); incognito + installed-profile linking both reach broker `302`; `POST /oauth/token → 200` observed in api logs.
- **Dependencies:** T50 (OAuth provider), T24.5 (PWA shell).
