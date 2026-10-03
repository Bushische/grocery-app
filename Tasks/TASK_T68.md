# T68 — Per-chat shared default: table + service
- **Goal:** Chats remember one shared grocery list, so repeat `/buy` works without a suffix.
- **Inputs:** `apps/api/src/db/schema.ts`, `apps/api/src/alice/links.ts` (pattern), `apps/api/drizzle/` (latest migration).
- **Outputs:** Migration `00NN_telegram-chat-defaults.ts` (`telegram_chat_defaults`: `chat_id TEXT PK`, `list_id → lists.id CASCADE`, `set_by_user_id → users.id CASCADE`, `updated_at`); `apps/api/src/telegram/chatDefaults.ts` (`getChatDefault`, `setChatDefault`, `clearChatDefault`) + `chatDefaults.test.ts`.
- **Definition of Done:** `get` returns unset when none/stale; `set` upserts shared row (last writer wins, stores setter for announce); stale list id (deleted list) reads as unset; FK cascades verified; full gate green.
- **Dependencies:** T67.
