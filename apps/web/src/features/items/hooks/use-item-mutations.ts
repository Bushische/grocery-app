import type { Item } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { itemsApi } from "../api/items-api";

type ItemsQueryData = { items: Item[] };

/**
 * Splits one cached items array into its TO_BUY / BOUGHT sections. Read helpers
 * for the optimistic updates below.
 */
function splitSections(data: ItemsQueryData): { toBuy: Item[]; bought: Item[] } {
  return {
    toBuy: data.items.filter((item) => item.status === "TO_BUY"),
    bought: data.items.filter((item) => item.status === "BOUGHT"),
  };
}

/**
 * Optimistically toggles an item's status inside the `["items", listId]` cache
 * (buy/unbuy). The move endpoint appends to the end of the target section;
 * the server response (incl. recomputed daysInList / usageCount) is reconciled
 * on success via invalidation.
 */
function applyMove(
  data: ItemsQueryData,
  itemId: string,
  target: "TO_BUY" | "BOUGHT",
): ItemsQueryData {
  const moving = data.items.find((item) => item.id === itemId);
  if (!moving) return data;
  const moved: Item = { ...moving, status: target };
  const without = data.items.filter((item) => item.id !== itemId);
  const targetSection = without.filter((item) => item.status === target);
  const otherSection = without.filter((item) => item.status !== target);
  return {
    // The moved item is appended to the end of its target section; the source
    // section keeps its remaining rows in order (T36: no duplicated row).
    items:
      target === "TO_BUY"
        ? [...targetSection, moved, ...otherSection]
        : [...otherSection, ...targetSection, moved],
  };
}

/** `POST /items/:id/move` with an optimistic status flip + rollback (docs/CONVENTIONS.md → Frontend). */
export function useMoveItem(listId: string) {
  const queryClient = useQueryClient();
  const key = itemsQueryKey(listId);
  return useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: "bought" | "to_buy" }) =>
      itemsApi.move(itemId, status),
    onMutate: async ({ itemId, status }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ItemsQueryData>(key);
      if (previous) {
        queryClient.setQueryData<ItemsQueryData>(
          key,
          applyMove(previous, itemId, status === "bought" ? "BOUGHT" : "TO_BUY"),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** `POST /lists/:id/items/reorder` — persists the new manual TO_BUY order. */
export function useReorderItems(listId: string) {
  const queryClient = useQueryClient();
  const key = itemsQueryKey(listId);
  return useMutation({
    mutationFn: (orderedIds: string[]) => itemsApi.reorder(listId, "TO_BUY", orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ItemsQueryData>(key);
      if (previous) {
        queryClient.setQueryData<ItemsQueryData>(key, reorderInCache(previous, orderedIds));
      }
      return { previous };
    },
    onError: (_error, _orderedIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Applies a persisted TO_BUY order to the cached items array (BOUGHT untouched). */
export function reorderInCache(data: ItemsQueryData, orderedIds: string[]): ItemsQueryData {
  const { toBuy, bought } = splitSections(data);
  const byId = new Map(toBuy.map((item) => [item.id, item]));
  const ordered: Item[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item) {
      ordered.push({ ...item, sortOrder: ordered.length });
      byId.delete(id);
    }
  }
  // Ids the server has but the client missed keep their relative order at the end.
  const remainder = [...byId.values()];
  return { items: [...ordered, ...remainder, ...bought] };
}
