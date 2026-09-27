import {
  type Category,
  type ListSummary,
  categorySchema,
  createListRequestSchema,
  itemsResponseSchema,
  listSummarySchema,
  updateListRequestSchema,
} from "@grocery/shared";
import { api } from "../../../lib/api";

/** Lists + per-list items/categories (docs/API.md → Lists, Items, Categories). */
export const listsApi = {
  /** GET /lists — the signed-in user's lists with role and item counts. */
  list: (signal?: AbortSignal) => api.get("/lists", listSummarySchema.array(), signal),
  /** POST /lists → 201 list (the summary shape, T6). */
  create: (title: string): Promise<ListSummary> =>
    api.post("/lists", createListRequestSchema.parse({ title }), listSummarySchema),
  /** PATCH /lists/:id → 200 list (the summary shape, OWNER only, T6). */
  update: (id: string, title: string): Promise<ListSummary> =>
    api.patch(`/lists/${id}`, updateListRequestSchema.parse({ title }), listSummarySchema),
  /** DELETE /lists/:id → 204 (OWNER only, enforced server-side). */
  remove: (id: string) => api.del(`/lists/${id}`),
  /** GET /lists/:id/items — all statuses, ordered by sortOrder then addedAt. */
  items: (listId: string, signal?: AbortSignal) =>
    api.get(`/lists/${listId}/items`, itemsResponseSchema, signal),
  /** GET /lists/:id/categories — color/title per category, ordered by sortOrder. */
  categories: (listId: string, signal?: AbortSignal): Promise<Category[]> =>
    api.get(`/lists/${listId}/categories`, categorySchema.array(), signal),
};
