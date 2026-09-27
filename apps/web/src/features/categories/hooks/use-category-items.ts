import { useQuery } from "@tanstack/react-query";
import { categoriesApi } from "../api/categories-api";

/** Category-filtered items, nested under the shared "items" key family. */
export const categoryItemsQueryKey = (categoryId: string) =>
  ["items", "category", categoryId] as const;

/** Items of one category, any status (GET /categories/:id/items). */
export function useCategoryItems(categoryId: string) {
  return useQuery({
    queryKey: categoryItemsQueryKey(categoryId),
    queryFn: ({ signal }) => categoriesApi.items(categoryId, signal),
  });
}
