# T83 — BOUGHT presentation: flat recency list, torn separator, grey wash
- **Goal:** The bought section reads as a faded receipt tail below TO_BUY — no grouping, freshly bought on top.
- **Inputs:** `item-sections.tsx` (Bought section currently grouped with handles — T75 overshoot to revert), `item-row.tsx` (bought muted style, T36), T75 (grouping is TO_BUY-only).
- **Outputs:** BOUGHT grouping + handles removed (flat list, freshly-bought-first recency — `onReorder` stays TO_BUY-only); category color bar kept but shaded/muted further than today; torn-receipt zigzag divider (`/\/\/\…`, pure CSS) between the TO_BUY and BOUGHT sections; bought section on a visibly greyer wash than TO_BUY's white.
- **Definition of Done:** Component tests pin flat recency order, no bought handles/groups, divider presence, muted bar + grey wash classes, bought rows still toggle back on tap; full gate green.
- **Dependencies:** T75.
