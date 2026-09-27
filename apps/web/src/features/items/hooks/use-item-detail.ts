import { useQuery } from "@tanstack/react-query";
import { itemsApi } from "../api/items-api";

/** Item detail query key per docs/CONVENTIONS.md → Frontend. */
export const itemDetailQueryKey = (itemId: string) => ["item", itemId] as const;

/** One item with its price history (GET /items/:id, docs/API.md → Items). */
export function useItemDetail(itemId: string) {
  return useQuery({
    queryKey: itemDetailQueryKey(itemId),
    queryFn: ({ signal }) => itemsApi.detail(itemId, signal),
  });
}
