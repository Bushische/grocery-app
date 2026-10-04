# T78 — Chat multi-add: exact-only dedup (no fuzzy merge of deliberate lists)
- **Goal:** `/buy item1, item2, item3` adds three items — near-miss fragments are created, never merged.
- **Inputs:** T65 (`handleAddMany` routes every fragment through `smartAddItem`), live report (Dice 0.75 merged `item2`/`item3` into `item1`).
- **Outputs:** `handleAddMany` uses `matchedBy`: `created`/`exact` as today; `substring`/`fuzzy` near-misses force-create via `createItem` (qty still applied). Single-add verb path unchanged (smart "did you mean" keep). JEV stays action-only — it cannot identify items (emits no text), so names always come from the splitter.
- **Definition of Done:** `item1, item2, item3` → 3 rows, reply names all three as added; exact dup still dedups; `apple`+`apples` coexist; single `buy apples` with `apple` listed still keeps (pinned); full gate green.
- **Dependencies:** T73.
