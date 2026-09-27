import { useMutation, useQueryClient } from "@tanstack/react-query";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { LISTS_QUERY_KEY } from "../../lists/hooks/use-lists";
import { itemsApi } from "../api/items-api";

/**
 * POST /lists/:id/items/smart-add from the bottom input box: the server either
 * matches an existing item (a BOUGHT match is re-activated at the end of
 * TO_BUY) or creates a new one in "Other" (docs/API.md → Items). Both outcomes
 * change the list's items and its counts, so both caches are invalidated.
 */
export function useSmartAdd(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => itemsApi.smartAdd(listId, text),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey(listId) });
      void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
    },
  });
}
