# T89 — Multi-add merges plurals/case without re-merging distinct items
- **Goal:** `add apple and oranges` with `Apple`/`Orange` listed keeps both (no `apple`/`oranges` dupes), while `item1, item2, item3` still yields three rows.
- **Inputs:** T78 (`handleAddMany` force-creates every near-miss), `textMatching.ts` Dice, live report (exact case-fold already keeps `apple`→`Apple`; `oranges`→`Orange` at Dice ~0.91 must merge, `item2`→`item1` at ~0.75 must not).
- **Outputs:** `handleAddMany` keep-tier becomes exact (case-fold) → plural-fold equality (`apples`→`apple`) → Dice ≥ 0.85 for typos (reactivate semantics kept); below that, create as today. No Levenshtein — Dice is the established metric. Single-add verb path untouched.
- **Definition of Done:** `Apple`+`add apple` → kept; `Orange`+`add oranges` → kept as `Orange`; `apple, apples` → kept (T78 coexistence test updated); `item1, item2, item3` → still 3 rows; full gate green.
- **Dependencies:** T88.
