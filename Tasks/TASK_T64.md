# T64 — Telegram chat live verification (webhook + intents + Mini App button)
- **Goal:** Real chats prove the loop: message → list → open-app button, in private and group.
- **Inputs:** T63 (webhook + intents), docs/TELEGRAM_PLAN.md (§7 ops: setWebhook, /setprivacy), tunnel public URL.
- **Outputs:** `setWebhook` registered (`…/api/telegram/bot-webhook` + secret + `allowed_updates=["message"]`), group privacy OFF (`/setprivacy` → Disable) for plain-text hearing, `/setcommands` optional; fixes in code only for issues the pass uncovers.
- **Definition of Done:** phone pass — private: link → `buy apples` → item in list → button opens Mini App → `what to buy` lists it → `bought apples` → `unbuy` → unknown name clarifies; group: plain `buy apples` heard (privacy off), mention works, off-topic stays silent; Alice voice for the same user still works; full gate green.
- **Dependencies:** T63.
