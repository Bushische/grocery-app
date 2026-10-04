# T79 — Alice concise acks + paginated list readout
- **Goal:** "Add eggs" → "Added." List readout gives 5, then the next 5 on "дальше".
- **Inputs:** `alice/dialog.ts` (sentence-long acks, `handleList` capped via `formatSpokenList`), `alice/nlu.ts` (no next-intent), `session_state` precedent (link-choice flow), `tts.ts` stress words.
- **Outputs:** One-word acks (`Добавлено./Added.`, `Уже в списке./Already on it.`, `Куплено./Done.`, `В покупках./Back on the list.` — errors/clarifies stay descriptive); `list` readout ordered newest-first (`addedAt` DESC, re-activated items count by re-activation) as `5 + "ещё N — скажите «дальше»"` with the offset in `session_state`; new next-intent (`дальше`, `ещё`, `next`, `more`) returns the next 5 (offset advanced, `Это всё./That's all.` at the end); any new list request or mutation resets the offset; TTS stress marks extended to the new short words.
- **Definition of Done:** Inject tests pin short acks (add/dup/buy/unbuy, RU+EN), newest-first first-5 + `дальше` → next-5 + end-of-list, offset reset after add; simulator/manual voice pass for stress sanity; full gate green.
- **Dependencies:** T78.
