import type { Category, CreateCategoryRequest, Item, UpdateCategoryRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { categoriesQueryKey } from "../../lists/hooks/use-categories";
import { itemsQueryKey } from "../../lists/hooks/use-items";
import { categoriesApi } from "../api/categories-api";
import { categoryItemsQueryKey } from "./use-category-items";

type ItemsQueryData = { items: Item[] };

/**
 * Applies a category patch to the cached categories array of one list
 * (title/color merged into the matching row).
 */
export function patchCategoryInList(
  categories: Category[],
  categoryId: string,
  patch: UpdateCategoryRequest,
): Category[] {
  return categories.map((category) =>
    category.id === categoryId ? { ...category, ...patch } : category,
  );
}

/** Removes a deleted category from the cached categories array of one list. */
export function removeCategoryFromList(categories: Category[], categoryId: string): Category[] {
  return categories.filter((category) => category.id !== categoryId);
}

/**
 * Applies a persisted category order to the cached categories array of one
 * list (sortOrder = index; ids the server has but the client missed keep
 * their relative order at the end) — the optimistic update of the reorder
 * mutation below.
 */
export function reorderCategoriesInList(categories: Category[], orderedIds: string[]): Category[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ordered: Category[] = [];
  for (const id of orderedIds) {
    const category = byId.get(id);
    if (category) {
      ordered.push({ ...category, sortOrder: ordered.length });
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}

/**
 * Re-colors/renames the embedded category copy on every cached item of the
 * category — this is what makes the main screen's color bars update instantly
 * (docs/TASKS.md → T19 Definition of Done).
 */
export function patchItemsCategory(
  data: ItemsQueryData,
  categoryId: string,
  patch: UpdateCategoryRequest,
): ItemsQueryData {
  return {
    items: data.items.map((item) =>
      item.category.id === categoryId
        ? { ...item, category: { ...item.category, ...patch } }
        : item,
    ),
  };
}

/**
 * PATCH /categories/:id with optimistic updates on every cache that renders
 * the category color: the list's categories, the main screen's items, and the
 * (optional) category-filtered items view. Rolled back on error; the server
 * response is reconciled via invalidation on settle.
 */
export function useUpdateCategory(listId: string) {
  const queryClient = useQueryClient();
  const categoriesKey = categoriesQueryKey(listId);
  const itemsKey = itemsQueryKey(listId);
  return useMutation({
    mutationFn: ({ categoryId, patch }: { categoryId: string; patch: UpdateCategoryRequest }) =>
      categoriesApi.update(categoryId, patch),
    onMutate: async ({ categoryId, patch }) => {
      const categoryItemsKey = categoryItemsQueryKey(categoryId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: categoriesKey }),
        queryClient.cancelQueries({ queryKey: itemsKey }),
        queryClient.cancelQueries({ queryKey: categoryItemsKey }),
      ]);
      const previousCategories = queryClient.getQueryData<Category[]>(categoriesKey);
      const previousItems = queryClient.getQueryData<ItemsQueryData>(itemsKey);
      const previousCategoryItems = queryClient.getQueryData<ItemsQueryData>(categoryItemsKey);
      if (previousCategories) {
        queryClient.setQueryData(
          categoriesKey,
          patchCategoryInList(previousCategories, categoryId, patch),
        );
      }
      if (previousItems) {
        queryClient.setQueryData(itemsKey, patchItemsCategory(previousItems, categoryId, patch));
      }
      if (previousCategoryItems) {
        queryClient.setQueryData(
          categoryItemsKey,
          patchItemsCategory(previousCategoryItems, categoryId, patch),
        );
      }
      return { previousCategories, previousItems, previousCategoryItems };
    },
    onError: (_error, variables, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(categoriesKey, context.previousCategories);
      }
      if (context?.previousItems) {
        queryClient.setQueryData(itemsKey, context.previousItems);
      }
      if (context?.previousCategoryItems) {
        queryClient.setQueryData(
          categoryItemsQueryKey(variables.categoryId),
          context.previousCategoryItems,
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
      void queryClient.invalidateQueries({ queryKey: itemsKey });
      void queryClient.invalidateQueries({
        queryKey: categoryItemsQueryKey(variables.categoryId),
      });
    },
  });
}

/**
 * POST /lists/:id/categories/reorder (docs/API.md → Categories) with an
 * optimistic reorder of the `["categories", listId]` cache + rollback. The
 * `["items", listId]` cache (main-screen grouping) and the category picker
 * (which reads the same categories query) are invalidated on settle so both
 * follow the new order after the refetch.
 */
export function useReorderCategories(listId: string) {
  const queryClient = useQueryClient();
  const categoriesKey = categoriesQueryKey(listId);
  const itemsKey = itemsQueryKey(listId);
  return useMutation({
    mutationFn: (orderedIds: string[]) => categoriesApi.reorder(listId, orderedIds),
    onMutate: async (orderedIds) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: categoriesKey }),
        queryClient.cancelQueries({ queryKey: itemsKey }),
      ]);
      const previousCategories = queryClient.getQueryData<Category[]>(categoriesKey);
      const previousItems = queryClient.getQueryData<ItemsQueryData>(itemsKey);
      if (previousCategories) {
        queryClient.setQueryData(
          categoriesKey,
          reorderCategoriesInList(previousCategories, orderedIds),
        );
      }
      return { previousCategories, previousItems };
    },
    onError: (_error, _orderedIds, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(categoriesKey, context.previousCategories);
      }
      if (context?.previousItems) {
        queryClient.setQueryData(itemsKey, context.previousItems);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
      void queryClient.invalidateQueries({ queryKey: itemsKey });
    },
  });
}

/**
 * POST /lists/:id/categories (docs/TASKS.md → T25): the server appends the
 * category (sortOrder = max+1, itemCount 0), so the refetched list places it
 * last — no optimistic insert needed (the response carries the server id).
 */
export function useCreateCategory(listId: string) {
  const queryClient = useQueryClient();
  const categoriesKey = categoriesQueryKey(listId);
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) => categoriesApi.create(listId, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });
}

/**
 * DELETE /categories/:id with an optimistic row removal (rolled back on the
 * 409 the server returns while items still reference the category).
 */
export function useDeleteCategory(listId: string) {
  const queryClient = useQueryClient();
  const categoriesKey = categoriesQueryKey(listId);
  return useMutation({
    mutationFn: (categoryId: string) => categoriesApi.remove(categoryId),
    onMutate: async (categoryId) => {
      await queryClient.cancelQueries({ queryKey: categoriesKey });
      const previousCategories = queryClient.getQueryData<Category[]>(categoriesKey);
      if (previousCategories) {
        queryClient.setQueryData(
          categoriesKey,
          removeCategoryFromList(previousCategories, categoryId),
        );
      }
      return { previousCategories };
    },
    onError: (_error, _categoryId, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(categoriesKey, context.previousCategories);
      }
    },
    onSuccess: (_data, categoryId) => {
      queryClient.removeQueries({ queryKey: categoryItemsQueryKey(categoryId) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKey });
    },
  });
}
