# T72 — Bare slash-commands survive stripping (/list, /lists, /help, /start)
- **Goal:** `/list` shows the list and `/help` helps — no more "Didn't get that" for bare commands.
- **Inputs:** T69–T70 (`extractCommandText`, `answerChatCommand`), live report (bare slash-commands stripped to `""` before the dialog).
- **Outputs:** `extractCommandText` keeps the word for bare informational commands (`/list`, `/lists`, `/help`, `/start` → `list`, `lists`, `help`, `start`); bare grocery verbs (`/buy`, `/bought`, …) still strip to `""` (reply-flow + clarify preserved).
- **Definition of Done:** webhook end-to-end — private `/list` lists items, `/lists` lists lists, `/help` helps; group `/list` (addressed) lists; bare `/buy`-as-reply still consumes the quote; full gate green.
- **Dependencies:** T70.
