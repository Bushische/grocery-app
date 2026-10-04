# T86 — Edit sheet gains "full details" button
- **Goal:** From the swipe-left edit sheet, one tap digs into the full details page.
- **Inputs:** T84 (`ItemEditSheet` with `ItemEditForm`, no exit except save/close), `onOpenDetails` navigation.
- **Outputs:** Sheet gets an `Open full details` action (closes the sheet, navigates to `/lists/:listId/items/:id`); quick title/qty/category edit stays in the sheet.
- **Definition of Done:** Tap opens the details route for the same item and closes the sheet; save flow untouched; full gate green.
- **Dependencies:** T84.
