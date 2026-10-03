# T67 — Chat-commands live verification (privacy-ON + reply flow + LLM fallback)
- **Goal:** Real chats prove scenarios 1–3 and the LLM fallback, with privacy ON.
- **Inputs:** T66 (full pipeline), docs/TELEGRAM_PLAN.md (§7 + T65–T66 notes), tunnel public URL.
- **Outputs:** BotFather `/setprivacy` → Enable (then RE-ADD the bot to every test group — the flip does not apply in place), `/setcommands` registered; fixes in code only for issues the pass uncovers.
- **Definition of Done:** phone pass — private `/buy milk, bread` → two items; group plain `buy apples` → silence (privacy ON, nothing delivered); group `/buy milk` → added; reply-`/buy` to a 3-line list → three items; unstructured "something for breakfast" → LLM summary reply; same-user Alice voice still works; api-log LLM call count matches fallback-only expectation; full gate green.
- **Dependencies:** T66.
