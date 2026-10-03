# T52 — Alice grocery intents (list/add/buy/unbuy)
- **Goal:** Voice control of the bound grocery list (bound in T51 — Alice sees exactly
  one list per user) in Russian via linked Alice.
- **Inputs:** T51 (webhook + user resolution), T8/T9 (smart-add/move semantics incl. T48
  top-of-bought), `textMatching` Dice + `searchService` for name matching,
  docs/ALICE_PLAN.md (§3 dialog); `YANDEX.NUMBER` shape verified against
  `request-simpleutterance` doc during implementation.
- **Outputs:** `apps/api/src/alice/dialog.ts` (+ `nlu.ts`, `tts.ts`): "что купить" reads
  TO_BUY (cap 5–7 spoken + "и ещё N"); "добавь молоко" smart-adds into the bound list;
  "купили молоко" moves to BOUGHT; "верни молоко" moves back to TO_BUY;
  `tts` mirrors `text` with `+`-stress on key words; `dangerous_context` graceful reply.
- **Definition of Done:** inject test per intent (happy + unlinked + invalid token);
  buy-then-buy order follows T48; unknown item name → clarification, not a wrong move;
  spoken lists capped; full gate green.
- **Dependencies:** T51, T48.
