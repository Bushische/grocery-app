import type { Item, UpdateItemRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesQueryKey } from "../../lists/hooks/use-categories";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { LISTS_QUERY_KEY } from "../../lists/hooks/use-lists";
import { itemsApi } from "../api/items-api";
import { itemDetailQueryKey } from "./use-item-detail";

/**
 * Mutations behind the item details page (docs/TASKS.md → T18). Every success
 * invalidates the `["item", itemId]` detail and — when the list is known — the
 * `["items", listId]` cache of the main screen and the list's category counts.
 */
function useInvalidateItemCaches(listId: string | null, itemId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: itemDetailQueryKey(itemId) });
    if (listId !== null) {
      void queryClient.invalidateQueries({ queryKey: itemsQueryKey(listId) });
      void queryClient.invalidateQueries({ queryKey: categoriesQueryKey(listId) });
    }
  };
}

/** PATCH /items/:id — title, category, quantity. */
export function useUpdateItem(listId: string | null, itemId: string) {
  const invalidate = useInvalidateItemCaches(listId, itemId);
  return useMutation({
    mutationFn: (patch: UpdateItemRequest) => itemsApi.update(itemId, patch),
    onSettled: invalidate,
  });
}

/** POST /items/:id/prices — appends a price observation (chart + currentPrice). */
export function useAddItemPrice(listId: string | null, itemId: string) {
  const invalidate = useInvalidateItemCaches(listId, itemId);
  return useMutation({
    mutationFn: (observation: { price: number; shop: string }) =>
      itemsApi.addPrice(itemId, observation),
    onSettled: invalidate,
  });
}

/** POST /items/:id/image — multipart upload of the client-downscaled photo. */
export function useUploadItemImage(listId: string | null, itemId: string) {
  const invalidate = useInvalidateItemCaches(listId, itemId);
  return useMutation({
    mutationFn: ({ image, filename }: { image: Blob; filename: string }) =>
      itemsApi.uploadImage(itemId, image, filename),
    onSettled: invalidate,
  });
}

/** Drops one row from the cached `["items", listId]` array (pure helper). */
export function removeItemFromCache(data: { items: Item[] }, itemId: string): { items: Item[] } {
  return { items: data.items.filter((item) => item.id !== itemId) };
}

/**
 * DELETE /items/:id (EDITOR+) with optimistic row removal + rollback. On
 * success the detail query is dropped and the list/category caches are
 * invalidated (counts, colors); the page navigates back via `onSuccess`.
 */
export function useDeleteItem(listId: string | null) {
  const queryClient = useQueryClient();
  const key = listId === null ? null : itemsQueryKey(listId);
  return useMutation({
    mutationFn: (itemId: string) => itemsApi.remove(itemId),
    onMutate: async (itemId) => {
      if (key === null) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ items: Item[] }>(key);
      if (previous) {
        queryClient.setQueryData(key, removeItemFromCache(previous, itemId));
      }
      return { previous };
    },
    onError: (_error, _itemId, context) => {
      if (key !== null && context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSuccess: (_data, itemId) => {
      queryClient.removeQueries({ queryKey: itemDetailQueryKey(itemId) });
      if (listId !== null) {
        void queryClient.invalidateQueries({ queryKey: itemsQueryKey(listId) });
        void queryClient.invalidateQueries({ queryKey: categoriesQueryKey(listId) });
      }
      void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
    },
  });
}
