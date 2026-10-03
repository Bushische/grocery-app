# T71 — Chat-default live verification + docs
- **Goal:** Real phone pass proves the friction is gone, docs match the new behavior.
- **Inputs:** T70 (full pipeline), `docs/TELEGRAM_PLAN.md` §7, `docs/DEPLOYMENT_UPDATE_SYNOLOGY.md` Step 8b, BotFather `/setcommands`.
- **Outputs:** `setWebhook` with `["message","callback_query"]`, `/setcommands` extended (`lists`, `use`, `help`); `TELEGRAM_PLAN.md` §7 "stateless" paragraph replaced by shared-default + titles-visible rule; deploy doc updated (`setWebhook` curl + commands list).
- **Definition of Done:** Phone pass — private: `/lists` → `/use <name>` → bare `/buy milk` lands silently; group: tap-a-list → `●` follows, second member's bare `/buy` lands on same list, switch announced; caller without access sees 🔒 + rights reply (owner adds on request); Alice voice unchanged; full gate green.
- **Dependencies:** T70.
