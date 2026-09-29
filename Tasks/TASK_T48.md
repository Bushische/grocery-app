# T48 — Bought items land on top of the bought list
- **Goal:** Buying an item puts it at the TOP of the BOUGHT section (most recent first),
  not the bottom. Un-buying still puts it at the BOTTOM of TO_BUY (unchanged).
- **Inputs:** T9 (`moveTo` in `apps/api/src/services/itemService.ts`), T27/T36 (optimistic
  `applyMove` in web `use-item-mutations.ts`), docs/API.md move contract (lines ~129-131).
- **Outputs:** `moveTo` to-BOUGHT sets `sortOrder = min-1` of the BOUGHT section (prepend)
  instead of `max+1`; to-TO_BUY keeps `max+1` (append). Web optimistic `applyMove` mirrors
  this (prepend into BOUGHT cache, append into TO_BUY cache). docs/API.md move lines updated
  (`to bought: ... sortOrder = top`). Same-status re-buy keeps T9 unconditional semantics
  (re-buy moves the item to the top). Smart-add re-activation (BOUGHT→TO_BUY) unchanged.
- **Definition of Done:** buy A then B → BOUGHT order [B, A] from the API and in the UI cache;
  un-buy → appended at end of TO_BUY; re-buy of an already-BOUGHT item moves it to top;
  existing move/reorder tests updated where they pinned append (task-sanctioned); full gate green.
- **Dependencies:** T9, T27.
