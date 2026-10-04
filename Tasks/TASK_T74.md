# T74 — Formatted bot replies: newlines + bullets for list-family messages
- **Goal:** Bot answers read as structured messages (one bullet per list/item), not single-line paragraphs.
- **Inputs:** T69–T73 reply builders (`apps/api/src/telegram/botDialog.ts`, `botWebhook.ts` choice confirms), plain-text sender (`botApi.ts`, no `parse_mode` — titles never escaped).
- **Outputs:** `/grocery_lists`, need-choice (incl. 🔒 line), `/help`, `what to buy` list, add-many summary, and tap/`/use_list` confirms use `\n` bullets (`• …`, `●` marks the chat default); grocery verbs' one-liners (`Added…`, `Marked…`) stay single-line; still plain text, no `parse_mode`.
- **Definition of Done:** Unit + webhook tests pin the exact multi-line strings (EN+RU); no reply exceeds Telegram's 4096-char limit (list caps already bound this); full gate green.
- **Dependencies:** T73.
