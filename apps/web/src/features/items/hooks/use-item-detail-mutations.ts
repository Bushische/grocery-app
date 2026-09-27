import type { UpdateItemRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesQueryKey } from "../../lists/hooks/use-categories";
import { itemsQueryKey } from "../../lists/hooks/use-items";
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
