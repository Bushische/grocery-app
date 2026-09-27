import { useQuery } from "@tanstack/react-query";
import { listsApi } from "../api/lists-api";

/** Categories query key — one entry per list, per docs/CONVENTIONS.md → Frontend. */
export const categoriesQueryKey = (listId: string) => ["categories", listId] as const;

/**
 * Categories of one list (GET /lists/:id/categories) for the details page's
 * category select. Enabled only with a known list — the details view receives
 * the list id through the navigation state of the main screen's long-press.
 */
export function useCategories(listId: string | null) {
  return useQuery({
    queryKey: categoriesQueryKey(listId ?? ""),
    queryFn: ({ signal }) => {
      if (listId === null) throw new Error("useCategories requires a listId");
      return listsApi.categories(listId, signal);
    },
    enabled: listId !== null,
  });
}
