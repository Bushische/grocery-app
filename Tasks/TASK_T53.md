# T53 — Alice console setup + live verification + moderation
- **Goal:** Skill registered, linked, voice-verified end to end, submitted for moderation.
- **Inputs:** T50 (linking URLs + client credentials), T52 (working intents),
  docs/ALICE_PLAN.md (§3 console/ops, §5); existing Cloudflare Tunnel public URL.
- **Outputs:** console skill record (name, category, icon, description, activation
  phrases), webhook URL `https://grocery.<domain>/api/alice/webhook`, linking-tab values
  (app id/secret, authorize/token/refresh URLs, scope `alice`); fixes in code only for
  issues the live pass uncovers (each fix + test, same commit discipline).
- **Definition of Done:** simulator pass (link → welcome → add → list → buy → unbuy);
  real-voice pass on a phone (same flow + dismiss/relink after manual revoke);
  measured tunnel round trip within Yandex's response limit; moderation submitted
  (submit itself is manual in the console); full gate green.
- **Dependencies:** T52.
