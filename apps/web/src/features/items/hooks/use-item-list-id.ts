import type { ItemDetail, ItemsResponse } from "@grocery/shared";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { itemsApi } from "../api/items-api";

/** Query key of the itemId → listId resolution (never invalidated by item edits). */
const itemListIdQueryKey = (itemId: string) => ["item-list", itemId] as const;

/**
 * Scans the cached `["items", listId]` queries for the item (pure helper) —
 * the zero-cost resolution when the item is already on screen. Category-view
 * caches (`["items", "category", id]`) are skipped: their first key segment
 * after "items" is not a list id.
 */
export function findItemListIdInCache(queryClient: QueryClient, itemId: string): string | null {
  for (const query of queryClient.getQueryCache().findAll()) {
    if (query.queryKey[0] !== "items" || query.queryKey.length !== 2) continue;
    const listId = query.queryKey[1];
    if (typeof listId !== "string") continue;
    const data = query.state.data as ItemsResponse | undefined;
    if (data?.items.some((item) => item.id === itemId)) return listId;
  }
  return null;
}

/**
 * The owning list of an item WITHOUT navigation state (docs/TASKS.md → T41):
 * the `["items", listId]` caches when the item is already loaded there, else
 * `GET /search?q=<title>` — the one contract payload that maps itemId →
 * listId. Feeds the legacy `/items/:id` deep-link route; the canonical
 * `/lists/:listId/items/:itemId` route takes the id straight from the URL.
 * Returns null until a source resolves (the page then degrades to read-only).
 */
export function useItemListId(itemId: string, detail: ItemDetail | undefined): string | null {
  const queryClient = useQueryClient();
  const cached = findItemListIdInCache(queryClient, itemId);
  const search = useQuery({
    queryKey: itemListIdQueryKey(itemId),
    queryFn: ({ signal }) => {
      if (!detail) throw new Error("useItemListId requires the item detail");
      return itemsApi.search(detail.title, signal).then((response) => {
        const hit = response.results.find((result) => result.itemId === itemId);
        return hit?.listId ?? null;
      });
    },
    enabled: cached === null && detail !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (cached !== null) return cached;
  return search.data ?? null;
}
