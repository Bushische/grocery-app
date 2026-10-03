# Alice AI (Yandex) integration — plan (DRAFT for review)

Goal: expose the grocery service to external assistants, starting with Alice AI from Yandex,
so a user can manage their grocery lists by voice. Account linking is via our own login
with **email** (OAuth 2.0 authorization code grant, our app is the authorization server).

> Status: investigation done, no code written. This document is for review. After approval,
> implementation is split into per-task files (`Tasks/TASK_Txx.md`), one task per phase below.
> Official docs: https://yandex.ru/dev/dialogs/alice/doc/ru/ (all claims below link there).

## 1. How Alice talks to us (protocol summary)

- Yandex sends `POST https://<our-domain>/api/alice/webhook` with JSON, protocol `version: "1.0"`.
  Request: `meta` (locale/timezone/interfaces) + `request` (`type`: `SimpleUtterance` |
  `ButtonPressed`, `command` = normalized lowercase phrase, `original_utterance`, `nlu`
  with `tokens` + `entities`) + `session` (`session_id`, `skill_id`, `application_id`,
  `session.user.user_id` + `session.user.access_token` when linked) + `state`
  (session/user/application buckets, ≤1 KB each). Ref: `alice/doc/ru/request`.
- We answer `{ response: { text, tts?, buttons?, end_session }, session_state?,
  user_state_update?, version: "1.0" }`. `text`/`tts` ≤ 1024 chars each; buttons:
  title ≤ 64, url ≤ 1024, payload ≤ 4096 bytes. Round trip must be fast (Yandex enforces
  a response-time limit of a few seconds — keep p95 < 2 s; our in-process SQLite easily fits).
  Ref: `alice/doc/ru/response`.
- Request authentication from Yandex side: the protocol has **no signature**. Verify
  `session.skill_id` equals our skill id (reject anything else), and optionally put a
  secret segment in the webhook URL.
- The skill is configured in https://dialogs.yandex.ru/developer/ (name, webhook URL,
  account-linking tab, test simulator, publication/moderation ~3 days).

## 2. Account linking design (Alice user ↔ our email user)

Only OAuth 2.0 **authorization code grant with our own authorization server** is accepted
for publication. Flow (refs: `alice/doc/ru/auth/when-to-use`, `auth/create-server`,
`auth/make-skill`, `auth/add-skill-to-console`, `auth/how-it-works`):

1. Unlinked user asks for private data → we answer `{ "start_account_linking": {} }`
   (**without** `response` — both together is an invalid response). Alice shows
   an "Авторизоваться" button. Only send it when `meta.interfaces.account_linking`
   exists; otherwise reply "surface does not support authorization" (sending it anyway
   counts as an invalid response; too many → skill blocked).
2. User taps it → Yandex redirects (in a webview) to our **authorize URL** with
   `response_type=code`, `client_id`, `redirect_uri=https://social.yandex.net/broker/redirect`,
   `scope`, `state`.
3. Our page: user logs in with **email + password** (existing `authService` bcrypt check),
   sees a consent screen ("Allow Alice to access your grocery lists?"), we issue a
   single-use authorization `code` (10-min TTL) and redirect to
   `https://social.yandex.net/broker/redirect?code=…&state=…`.
   At this moment we bind: `code → internal userId` (found by email at login).
4. Yandex exchanges the code at our **token URL** → we return
   `{ access_token, refresh_token?, expires_in }` (response ≤ 5000 chars, tokens ≤ 2048
   chars, `expires_in` integer 1..2³²). Yandex stores both tokens.
5. Every later skill request carries `Authorization: Bearer <access_token>` **and**
   `session.user.access_token`. We validate the token → internal user → reuse all existing
   services/guards (`requireListRole`, …) unchanged. Yandex auto-refreshes via our
   **refresh URL** (must answer < 5 s, it retries once; on failure the user must relink,
   and we must answer `start_account_linking` again on invalid tokens).
6. Yandex console "Account linking" tab gets: Application ID (= our OAuth client id),
   Application secret, Authorization URL, Get-token URL, Refresh-token URL, scope
   (proposed: `alice`).
7. Seamless UX: before answering `start_account_linking`, save the pending user request
   (in `session_state`); the post-link request arrives as `account_linking_complete_event`
   **without** `request.command` — answer the saved request immediately so the user does
   not repeat themselves.

Token model (mirrors existing `glc_` practice: hash-only storage, never plaintext):
`oauth_clients` (one pre-registered `alice` row: id + secret hash), `oauth_codes`
(code hash → userId, expiresAt, used flag), `oauth_tokens`
(token hash → userId, clientId, scope, accessExpiresAt, refreshTokenHash, refreshExpiresAt).
Access TTL 30 days (mobile-style, like our refresh cookies); refresh TTL 1 year.

## 3. What we must support (checklist)

**OAuth provider (new):**
- [ ] `GET /oauth/authorize` — login-with-email form + consent screen (HTML served by API,
      no web-app changes needed for v1).
- [ ] `POST /oauth/authorize` — verify email/password, create single-use code, redirect
      to `https://social.yandex.net/broker/redirect` echoing `state`.
- [ ] `POST /oauth/token` — `grant_type=authorization_code` → access+refresh tokens;
      `grant_type=refresh_token` → rotation. Client auth via `client_id`/`client_secret`.
- [ ] New DB tables (Drizzle migration): `oauth_clients`, `oauth_codes`, `oauth_tokens`.
- [ ] Values for the Yandex console linking tab (client id/secret generated at deploy,
      stored in `.env`, never committed).

**Alice webhook (new):**
- [ ] `POST /api/alice/webhook` — validate `skill_id`, parse with shared zod schemas,
      dispatch: `account_linking_complete_event` → finish pending request; missing/invalid
      token on private intents → `start_account_linking`; otherwise intent router.
- [ ] Never stay silent: EVERY request gets a response (docs count silence/timeout as an
      invalid response; too many → skill blocked). Private + unlinked/invalid token →
      link card (`start_account_linking` alone, never with `response`); surfaces without
      `meta.interfaces.account_linking` → graceful text message, never the card; public
      intents (welcome/help/fallback) may answer without auth. Ref: `auth/make-skill`.
- [ ] Token→user resolution as a `requireAlice`-style preHandler producing the same
      `request.user` shape as `requireAuth`, so existing list/item guards apply as-is.
- [ ] Single-list binding: Alice operates on exactly ONE list per user, persisted in
      `alice_links(userId PK → listId, createdAt)` (keyed by user, so it survives token
      rotation). Set on the first linked dialog turn: exactly one accessible list →
      bind silently; several → ask once ("Какой список использовать для Алисы?") with the
      answer carried via `session_state`, then bind. All intents use the bound list; if it
      becomes deleted/inaccessible → ask once again and rebind.
- [ ] Stateless otherwise: derive everything else from DB; `session_state` only for pending
      disambiguation (link replay, one-time list question).

**Dialog (v1 intent set, Russian, all on the bound list — see webhook section):**
- [ ] Welcome/help (`session.new`, "помощь") — what the skill can do + link prompt.
- [ ] "Что купить / что в списке" — read TO_BUY (cap 5–7 spoken + "и ещё N"), per bound list.
- [ ] "Добавь молоко / запиши хлеб" — smart-add into bound list (reuse `smartAdd` semantics).
- [ ] "Купили молоко / молоко купили" — move to BOUGHT (T48 top-of-bought semantics apply).
- [ ] "Верни молоко / снова в покупки" — move back to TO_BUY.
- [ ] Fallback ("не поняла") + dangerous-context graceful reply
      (`request.markup.dangerous_context`).
- [ ] NLU: `request.command` (already normalized: lowercase, digits as numbers) +
      `nlu.tokens` + built-in entities (`YANDEX.NUMBER` for quantities — verify exact shape
      in `alice/doc/ru/request-simpleutterance` during implementation); item-name matching
      reuses our `textMatching` Dice + `searchService`.
- [ ] TTS: mirror `text` with `+`-stress marks on key words; enumerate lists tersely.

**Console/ops (manual, not code):**
- [ ] Skill record (name, category, icon, description, activation phrases), webhook URL =
      `https://grocery.<domain>/api/alice/webhook` (existing Cloudflare Tunnel, no new infra).
- [ ] Linking-tab values from above; test in console simulator; voice test on a real surface;
      submit for moderation.

**Explicitly out of v1:** web UI for Alice (a "Connected services" page to view/revoke the
link would be the *second* dedicated folder `apps/web/src/features/alice/` — only if wanted);
quantity parsing beyond `YANDEX.NUMBER`; prices dialogue; switching the bound list by voice
(rebind = relink or a future intent); cards/images.

## 4. Folder layout (all Alice code isolated)

- `apps/api/src/alice/` — EVERYTHING skill-side in one folder:
  `protocol.ts` (zod schemas for request/response, shared with tests),
  `webhook.ts` (route registration; thin, like other `routes/`),
  `dialog.ts` (intent router + handlers calling existing `*Service.ts`),
  `links.ts` (single-list binding: get/set `alice_links`, first-turn bind logic),
  `nlu.ts` (command parsing helpers), `tts.ts` (text→tts + enumeration caps),
  `session.ts` (state save/restore helpers), `*.test.ts` next to each.
  Only touch outside the folder: one-line route registration in `app.ts`,
  new tables in `db/schema.ts` + migration (`alice_links` lands with T51's migration),
  shared scope constants in `packages/shared`.
- `apps/api/src/oauth/` — second folder for the provider side: `routes.ts`
  (authorize GET/POST, token POST), `oauthService.ts` (codes/tokens, hashing),
  consent HTML template, tests. Same one-line registration rule.
- No `apps/web` changes in v1 (consent page is API-served HTML).

## 5. Implementation phases (one `Tasks/TASK_Txx` each after this plan is approved)

- **T-A1 — OAuth tables + service:** `oauth_clients/codes/tokens` schema + migration,
  code/token/refresh issue/validate/rotate with sha256-hash storage, expiry enforcement,
  unit tests. No routes yet.
- **T-A2 — OAuth routes + consent page:** authorize GET/POST (email login via
  `authService`, consent screen, `social.yandex.net` redirect with `state` echo),
  token endpoint (both grant types, client authentication, Yandex limits:
  ≤5000-char response, ≤2048-char tokens), `.env` client credentials, tests via inject.
- **T-A3 — Webhook skeleton:** `apps/api/src/alice/` with protocol zod schemas,
  `skill_id` check, `requireAlice` token→user resolution, router with
  welcome/help/fallback + `start_account_linking` gating + `account_linking_complete_event`
  with pending-request replay; single-list binding (`alice_links` table + migration,
  first-turn auto-bind or ask-once via `session_state`, rebind if list lost).
  Test with captured console-simulator payloads.
- **T-A4 — Grocery intents:** list/add/buy/unbuy on the bound list via existing
  services; TTS enumeration caps; dangerous-context reply; full inject tests per intent
  (happy + unauthenticated + invalid token).
- **T-A5 — Console + live verification:** skill record, linking-tab values, simulator pass,
  real-voice pass (link → add → list → buy → unbuy → relink-after-revoke), then moderation
  submission. Mostly manual; code only for fixes the pass uncovers.

## 6. Risks / open questions for review

1. Email login inside Yandex's webview: our bcrypt login is reused, but is there any
   bot/captcha protection planned that could block the webview? (v1: no.)
2. Token TTL: 30-day access + 1-year refresh proposed; shorter access (e.g. 24 h) is safer
   but causes more refresh traffic — Yandex handles it transparently either way.
3. ~~Default-list choice for multi-list users (propose: first owned list + "which list?"~~
   ~~clarification) — confirm desired UX.~~ RESOLVED: Alice is bound to exactly ONE list
   per user (`alice_links`, set on first linked turn, auto if one list else ask once).
4. `start_account_linking` on every invalid token can loop a confused user; add a gentle
   "please relink in the Yandex app" voice message — confirm wording tone.
5. Response-time: our stack is in-process SQLite, but the tunnel adds latency — the live
   pass (T-A5) must measure end-to-end round trip stays within Yandex's limit.
