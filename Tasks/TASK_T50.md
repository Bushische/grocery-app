# T50 — OAuth provider: authorize/token routes + consent page
- **Goal:** The endpoints Yandex calls during linking: email login + consent → code,
  code → tokens, refresh → rotation, within Yandex's limits.
- **Inputs:** T49 (service), T5 (`authService` bcrypt email login to reuse),
  docs/ALICE_PLAN.md (§2 flow), `auth/create-server` + `auth/add-skill-to-console` docs.
- **Outputs:** `apps/api/src/oauth/routes.ts`: `GET /oauth/authorize` (login-with-email
  form + consent screen, API-served HTML, no web changes), `POST /oauth/authorize`
  (verify credentials, issue code, 302 to `https://social.yandex.net/broker/redirect`
  echoing `state`), `POST /oauth/token` (`authorization_code` + `refresh_token` grants,
  `client_id`/`client_secret` check, response ≤ 5000 chars, tokens ≤ 2048 chars, integer
  `expires_in`); OAuth client id/secret from `.env` (+ `.env.example` entries); inject tests.
- **Definition of Done:** full link-flow walkthrough by test (login → code → tokens →
  refresh rotation); wrong password → no code; bad client secret → 401; replayed code → 400;
  `state` echoed verbatim; full gate green.
- **Dependencies:** T49, T5.
