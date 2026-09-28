import { useMutation, useQueryClient } from "@tanstack/react-query";
import { itemsApi } from "../../items/api/items-api";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { LISTS_QUERY_KEY } from "../../lists/hooks/use-lists";
import { categoryItemsQueryKey } from "./use-category-items";

/**
 * Cache refresher shared by both category-scoped item mutations: the created /
 * re-activated row must appear in this category view, on the main screen's
 * list, and in the menu switcher's counts.
 */
function useInvalidateCategoryItemCaches(listId: string, categoryId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: categoryItemsQueryKey(categoryId) });
    void queryClient.invalidateQueries({ queryKey: itemsQueryKey(listId) });
    void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
  };
}

/**
 * POST /lists/:id/items with `categoryId` fixed to this category (docs/TASKS.md
 * → T43): the created item belongs to the category regardless of the "Other"
 * fallback — smart-add stays a main-screen behavior only.
 */
export function useCreateCategoryItem(listId: string, categoryId: string) {
  const invalidate = useInvalidateCategoryItemCaches(listId, categoryId);
  return useMutation({
    mutationFn: (title: string) => itemsApi.create(listId, { title, categoryId }),
    onSuccess: invalidate,
  });
}

/**
 * POST /items/:id/move { status: "to_buy" } for a BOUGHT suggestion of this
 * category (docs/TASKS.md → T43): re-activates the item in place.
 */
export function useReactivateCategoryItem(listId: string, categoryId: string) {
  const invalidate = useInvalidateCategoryItemCaches(listId, categoryId);
  return useMutation({
    mutationFn: (itemId: string) => itemsApi.move(itemId, "to_buy"),
    onSuccess: invalidate,
  });
}
