# T61 — Telegram bot setup + live verification
- **Goal:** Real phone proves the hybrid flow end to end while Alice keeps working for the same user.
- **Inputs:** T59 (endpoints + credentials), T60 (Mini App client), docs/TELEGRAM_PLAN.md (§3 bot/ops), existing Cloudflare Tunnel public URL.
- **Outputs:** BotFather record (bot, token in deploy `.env`, `/setdomain`, Menu Button `/newapp` URL `https://grocery.<domain>/`); fixes in code only for issues the live pass uncovers (each fix + test, same commit discipline); short ops note appended to docs/TELEGRAM_PLAN.md or docs/DEPLOYMENT.md.
- **Definition of Done:** phone pass (fresh open → link with password → kill → reopen = no password → unlink → relink; same user still drives Alice voice intents); tunnel round trip within Telegram's tolerance; full gate green.
- **Dependencies:** T60.
