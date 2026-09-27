import {
  type Category,
  type CreateCategoryRequest,
  type ItemsResponse,
  type UpdateCategoryRequest,
  categorySchema,
  createCategoryRequestSchema,
  itemsResponseSchema,
  updateCategoryRequestSchema,
} from "@grocery/shared";
import { api } from "../../../lib/api";

/** Category mutations + the category-filtered item read (docs/API.md → Categories). */
export const categoriesApi = {
  /** POST /lists/:id/categories — appends a category (EDITOR+, enforced server-side). */
  create: (listId: string, body: CreateCategoryRequest): Promise<Category> =>
    api.post(
      `/lists/${listId}/categories`,
      createCategoryRequestSchema.parse(body),
      categorySchema,
    ),
  /** PATCH /categories/:id — partial edit of title/color (EDITOR+, enforced server-side). */
  update: (categoryId: string, patch: UpdateCategoryRequest): Promise<Category> =>
    api.patch(
      `/categories/${categoryId}`,
      updateCategoryRequestSchema.parse(patch),
      categorySchema,
    ),
  /** DELETE /categories/:id → 204 (OWNER only); 409 while items still reference it. */
  remove: (categoryId: string) => api.del(`/categories/${categoryId}`),
  /** GET /categories/:id/items — items in the category, any status. */
  items: (categoryId: string, signal?: AbortSignal): Promise<ItemsResponse> =>
    api.get(`/categories/${categoryId}/items`, itemsResponseSchema, signal),
};
