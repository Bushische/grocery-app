import { useMutation, useQueryClient } from "@tanstack/react-query";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { LISTS_QUERY_KEY } from "../../lists/hooks/use-lists";
import { itemsApi } from "../api/items-api";

/**
 * Explicit "Create" action of the bottom input box (docs/TASKS.md → T26):
 * plain POST /lists/:id/items — unlike smart-add this endpoint never matches
 * existing items, so it always yields a separate row (duplicates included) in
 * the default "Other" category. Both caches are invalidated: the new item
 * changes the list's items and its counts.
 */
export function useCreateItem(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => itemsApi.create(listId, { title }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey(listId) });
      void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
    },
  });
}
