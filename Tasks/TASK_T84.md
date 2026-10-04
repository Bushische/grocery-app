# T84 — Swipe rework: Android delivery, Edit sheet, far-slide delete
- **Goal:** Swipe works on Android Chrome; left commits to an edit sheet, right far-slide deletes.
- **Inputs:** T76 (`item-row.tsx` pointer swipe, `swipe-action.ts` single-threshold reveal, Edit → details, tap arm→confirm Delete).
- **Outputs:** `touch-action: pan-y` on the row body so Android delivers horizontal moves; reveal (~1/3 width) + commit (~2/3) thresholds in `swipeRevealForDelta` (pure, pinned; short swipes snap back); left-commit opens an edit bottom-sheet reusing `ItemEditForm` (title/qty/category, save + close); right underlayer turns red `Release to delete` past commit and releasing there deletes (far slide is the confirmation; 403 reverts via the existing path); desktop right-click → details unchanged; long-press stays removed.
- **Definition of Done:** Real-Android pass (Chrome) + pins: thresholds/reveal/commit/snap-back, sheet opens + saves, far-release deletes, tap-after-swipe never toggles, vertical scroll never reveals; mouse suite unchanged; full gate green.
- **Dependencies:** T76.
