# T92 — Save button shows Saved feedback and shades off after save
- **Goal:** After tapping Save changes (details page and edit sheet), the button reads Saved, shades off and disables; editing again re-arms it to Save changes.
- **Inputs:** `item-edit-form.tsx` (`isDirty`-gated submit, fire-and-forget `onSave`, never `reset()` — dirty stays true forever), `item-details-page.tsx` + `item-edit-sheet.tsx` (`mutate` callers), T91 `midActions` slot (untouched).
- **Outputs:** `ItemEditForm` awaits `onSave` (now may return a promise), `reset(values)` + Saved state on success, try/catch keeps the form dirty for retry on failure; callers switch to `mutateAsync` (sheet still closes on success); button label Saving…/Saved/Save changes with disabled state `pending || !isDirty`.
- **Definition of Done:** Unit tests pin initial shaded Save changes, Saved + disabled after successful save, re-arm on further edit, and retryable Save changes on rejected save; sheet save-and-close + details save specs still green; full gate green.
- **Dependencies:** T91.
