# T56 — Delete item from the details page (typo fix)
- **Goal:** A wrongly added item (e.g. a typo) can be removed without backend workarounds.
- **Inputs:** `DELETE /items/:id` (exists, EDITOR+, T8); `apps/web/src/features/items/api/items-api.ts`, `hooks/use-item-detail-mutations.ts`, `pages/item-details-page.tsx`; two-step confirm pattern from `DeleteListButton`.
- **Outputs:** `itemsApi.remove`, `removeItemFromCache` pure helper + `useDeleteItem(listId)` (optimistic row removal + rollback; drops the detail query, invalidates items/categories/lists on success); "Danger zone" section on `ItemDetailsPage` (Delete → Confirm delete / Cancel, 403-aware banner, back to the list on success).
- **Definition of Done:** happy path (DELETE → row gone → `/lists/:id`) + 403 banner pins in `item-details-page.test.tsx`; pure helper pins in `use-item-detail-mutations.test.ts`; `pnpm test && pnpm lint` green.
- **Dependencies:** T8 (item endpoints), T18 (details page).
