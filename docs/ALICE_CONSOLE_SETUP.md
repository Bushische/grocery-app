# Alice dialog skill — console configuration guide

Step-by-step setup of our skill in the Yandex developer console.
Code side must be deployed first (T50–T52): webhook + OAuth live at the public URL.
Official docs: https://yandex.ru/dev/dialogs/alice/doc/ru/ (skill creation, account
linking, testing, publication).

## 0. Prerequisites

- [ ] Public HTTPS base URL of our service: `https://grocery.<your-domain>`
      (existing Cloudflare Tunnel → `web:8080`; the tunnel proxies `/api` to the api service).
- [ ] Server `.env` has real values (never commit them):
      `OAUTH_CLIENT_ID=alice`, `OAUTH_CLIENT_SECRET=<long random>`,
      `ALICE_SKILL_ID=<from step 2>`. Template: `.env.example`.
- [ ] A Yandex account (to open the console).

Our concrete endpoints (used below):

| Purpose              | Value                                            |
|----------------------|--------------------------------------------------|
| Webhook              | `https://grocery.<your-domain>/api/alice/webhook` |
| OAuth authorize page | `https://grocery.<your-domain>/oauth/authorize`   |
| OAuth token + refresh| `https://grocery.<your-domain>/oauth/token`       |
| OAuth scope          | `alice`                                          |

## 1. Create the skill

1. Open https://dialogs.yandex.ru/developer/ and log in.
2. Create a dialog → type **«Навык в Алисе»** (Skill in Alice).
3. Skill name, e.g. `Grocery List` (must be unique in the store for publication).
4. Tab **Настройки** → block **Backend** → **Webhook URL**: paste the webhook value
   from the table above → **Save**. No validation happens at this point — the backend
   does NOT need to be live yet, so create the skill first and deploy after.
   (Chicken-and-egg resolved: skill shell first → skill id → deploy → linking tab.)
5. Tab **Общие сведения** (bottom of the page): copy the **skill id** → put it into
   server `.env` as `ALICE_SKILL_ID` and restart the api service. Our webhook rejects
   any request whose `session.skill_id` differs.
   (Can't find the tab? The id is also the GUID in the console URL:
   `dialogs.yandex.ru/developer/skills/<skill-id>/draft/...` — same UUID format
   Yandex sends as `session.skill_id`.)

## 2. Account linking tab («Связка аккаунтов»)

Fill all mandatory fields and **Save** (ref: `auth/add-skill-to-console`):

| Console field              | Value                                              |
|----------------------------|----------------------------------------------------|
| Идентификатор приложения   | = server `OAUTH_CLIENT_ID` (`alice`)               |
| Секрет приложения          | = server `OAUTH_CLIENT_SECRET`                     |
| URL авторизации            | `https://grocery.<your-domain>/oauth/authorize`     |
| URL для получения токена   | `https://grocery.<your-domain>/oauth/token`         |
| URL для обновления токена  | `https://grocery.<your-domain>/oauth/token`         |
| Идентификатор группы действий (scope) | `alice`                                   |

What happens: user taps «Авторизоваться» → webview opens our authorize URL with
`response_type=code&client_id=alice&redirect_uri=https://social.yandex.net/broker/redirect&scope=alice&state=…`
→ user logs in with **email + password**, confirms consent → we redirect to the broker
with `code` + `state` → Yandex exchanges the code at our token URL → tokens stored by
Yandex and sent with every later request (`Authorization` header + `session.user`).

## 3. Test in the console simulator

1. Tab **Тестирование** → chat window. Send `помощь` → welcome text must arrive.
2. Ask for a list (`что купить`) while unlinked → Alice shows the «Авторизоваться»
   button (our `start_account_linking`).
3. Tap it → our login page opens → log in with a real account email → consent →
   back in chat, the saved request is answered immediately (no repetition).
4. Voice flow: `добавь молоко` → `что купить` (hears it back) → `купили молоко` →
   `верни молоко`. Multi-list account: first turn asks once which list Alice should use.
5. Negative: revoke access (change password / revoke in a future management UI) →
   next private request shows the link button again.

Known console quirks:
- Testing in the console **permanently activates** the skill on your Yandex account —
  activation phrases (`запусти навык …`) can only be tested in a real Yandex app
  (phone/speaker/browser) logged into the same account.
- Watch the api logs during tests: every Yandex request and our response code.

## 4. Publish

Skill record to fill in the console (tab **Публикация**; name must be unique
in the store):

| Field | Value |
|---|---|
| Name | `Grocery List` |
| Category | Покупки (shopping) |
| Description | Голосовой помощник для списка покупок: показывает, что нужно купить, добавляет товары и отмечает купленное. Требуется привязка аккаунта. |
| Activation phrases | `запусти навык список покупок`, `что купить`, `добавь молоко` |
| Icon | 512×512 PNG (app icon, no transparency) |
| Webhook | `https://grocery.<your-domain>/api/alice/webhook` (from the table above) |

Required before moderation (~3 days): activation phrases, category, description, icon.
Checklist: linking works from a fresh account; unlinked users get the button (never
silence); surfaces without `account_linking` get a graceful message; TTS ≤ 1024 chars;
no crashes on unexpected phrases (fallback). Covered by the automated simulator
pass (`apps/api/src/alice/simulator.test.ts`: link → welcome → add → list → buy →
unbuy + revoke/relink, every turn protocol-valid and < 1 s locally, leaving
headroom for the tunnel inside Yandex's response limit). Then submit for review
in the console (the submit button itself is manual).

## 5. Troubleshooting

| Symptom | Likely cause |
|---|---|
| «Навык не отвечает» on every phrase | Webhook unreachable (tunnel down), non-HTTPS, or response is not protocol 1.0 (`version`, `response.text`/`end_session` required). |
| Link button does nothing / loops | Authorize/token URLs wrong, `state` not echoed, token response > 5000 chars, or `ALICE_SKILL_ID` mismatch. |
| Linked but «need to relink» every time | Token validation fails server-side (check api logs) or refresh endpoint too slow (> 5 s). |
| Works in simulator, not on speaker | Auth-capable surfaces only: Yandex app iOS/Android, TV, speakers, Browser. |
