# T87 — Bought items land on top of the section, not top of group
- **Goal:** Last bought item is always first in BOUGHT — no category clustering.
- **Inputs:** T75 (`moveTo`: BOUGHT inserts at `topOfRunIndex` — the grouping leftover), T83 (flat recency rendering).
- **Outputs:** `moveTo` BOUGHT inserts at section top (pos 0 + shift followers); TO_BUY end-of-run insert unchanged; `topOfRunIndex` stays for TO_BUY paths only (or goes if unused).
- **Definition of Done:** Service tests pin buy → index 0 across categories, repeated buys stack newest-first, unbuy still end-of-run; full gate green.
- **Dependencies:** T83.
