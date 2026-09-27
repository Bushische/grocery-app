import { useQuery } from "@tanstack/react-query";
import { listsApi } from "../api/lists-api";

/** Query key per docs/CONVENTIONS.md → Frontend. */
export const itemsQueryKey = (listId: string) => ["items", listId] as const;

/**
 * Items of one list (all statuses; docs/API.md → Items). A different list id
 * means a different cache entry, so switching lists always fetches that list.
 */
export function useItems(listId: string | null) {
  return useQuery({
    queryKey: itemsQueryKey(listId ?? ""),
    queryFn: ({ signal }) => {
      if (listId === null) throw new Error("useItems requires a listId");
      return listsApi.items(listId, signal);
    },
    enabled: listId !== null,
  });
}
