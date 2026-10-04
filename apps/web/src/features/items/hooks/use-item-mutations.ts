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
 * (buy/unbuy, T75 group-aware): buying lands at the top of its category run
 * in BOUGHT, un-buying at the end of its category run in TO_BUY (a missing
 * run appends as a trailing group) — mirroring the server's moveTo, incl.
 * sortOrder shifts so the grouped render keeps the optimistic position. The
 * server response is reconciled on success via invalidation.
 */
export function applyMove(
  data: ItemsQueryData,
  itemId: string,
  target: "TO_BUY" | "BOUGHT",
): ItemsQueryData {
  const moving = data.items.find((item) => item.id === itemId);
  if (!moving) return data;
  const categoryId = moving.category.id;
  const without = data.items.filter((item) => item.id !== itemId);
  const targetBlock = without
    .filter((item) => item.status === target)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const otherBlock = without.filter((item) => item.status !== target);
  let pos: number;
  if (target === "BOUGHT") {
    const first = targetBlock.findIndex((item) => item.category.id === categoryId);
    pos = first === -1 ? targetBlock.length : first;
  } else {
    let last = -1;
    for (const [index, item] of targetBlock.entries()) {
      if (item.category.id === categoryId) last = index;
    }
    pos = last === -1 ? targetBlock.length : last + 1;
  }
  let moved: Item;
  let nextTarget: Item[];
  if (pos >= targetBlock.length) {
    const sortOrder =
      targetBlock.length === 0 ? 0 : Math.max(...targetBlock.map((item) => item.sortOrder)) + 1;
    moved = { ...moving, status: target, sortOrder };
    nextTarget = [...targetBlock, moved];
  } else if (pos === 0) {
    moved = { ...moving, status: target, sortOrder: 0 };
    nextTarget = [
      moved,
      ...targetBlock.map((item) => ({ ...item, sortOrder: item.sortOrder + 1 })),
    ];
  } else {
    const threshold = targetBlock[pos]!.sortOrder;
    moved = { ...moving, status: target, sortOrder: threshold };
    nextTarget = [
      ...targetBlock.slice(0, pos),
      moved,
      ...targetBlock.slice(pos).map((item) => ({ ...item, sortOrder: item.sortOrder + 1 })),
    ];
  }
  return {
    items: target === "TO_BUY" ? [...nextTarget, ...otherBlock] : [...otherBlock, ...nextTarget],
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

/** Variables accepted by the reorder mutation: the legacy ids array means TO_BUY. */
export type ReorderVariables = { status: "TO_BUY" | "BOUGHT"; orderedIds: string[] } | string[];

/** `POST /lists/:id/items/reorder` — persists the new manual order of either section (T75). */
export function useReorderItems(listId: string) {
  const queryClient = useQueryClient();
  const key = itemsQueryKey(listId);
  return useMutation({
    mutationFn: (variables: ReorderVariables) => {
      const { status, orderedIds } = Array.isArray(variables)
        ? { status: "TO_BUY" as const, orderedIds: variables }
        : variables;
      return itemsApi.reorder(listId, status, orderedIds);
    },
    onMutate: async (variables) => {
      const { status, orderedIds } = Array.isArray(variables)
        ? { status: "TO_BUY" as const, orderedIds: variables }
        : variables;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ItemsQueryData>(key);
      if (previous) {
        queryClient.setQueryData<ItemsQueryData>(key, reorderInCache(previous, orderedIds, status));
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

/** Applies a persisted section order to the cache (other section untouched). */
export function reorderInCache(
  data: ItemsQueryData,
  orderedIds: string[],
  status: "TO_BUY" | "BOUGHT" = "TO_BUY",
): ItemsQueryData {
  const { toBuy, bought } = splitSections(data);
  const section = status === "TO_BUY" ? toBuy : bought;
  const other = status === "TO_BUY" ? bought : toBuy;
  const byId = new Map(section.map((item) => [item.id, item]));
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
  const nextSection = [...ordered, ...remainder];
  return {
    items: status === "TO_BUY" ? [...nextSection, ...other] : [...other, ...nextSection],
  };
}
