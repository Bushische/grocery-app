# T77 — Photo badge on rows with attached pictures
- **Goal:** Rows with an image show a 📸 badge by the age badge (right-aligned), signaling details worth opening.
- **Inputs:** `item-row.tsx` (age-badge slot), `Item.imageFilename` (nullable — badge iff non-null).
- **Outputs:** Photo badge next to the age badge in both TO_BUY and BOUGHT rows (muted with the row in bought state); decorative (`aria-hidden`, no new a11y name — the row label is unchanged).
- **Definition of Done:** Component tests: badge present iff `imageFilename` non-null, positioned by the age badge, absent otherwise; full gate green.
- **Dependencies:** T76.
