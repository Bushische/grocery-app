import {
  type CreateItemRequest,
  type Item,
  type ItemDetail,
  type PriceObservation,
  type SearchResponse,
  type SmartAddResponse,
  type SuggestResponse,
  type UpdateItemRequest,
  createItemRequestSchema,
  createPriceObservationRequestSchema,
  itemDetailSchema,
  itemImageResponseSchema,
  itemSchema,
  moveItemRequestSchema,
  priceObservationSchema,
  reorderRequestSchema,
  searchResponseSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
  suggestResponseSchema,
  updateItemRequestSchema,
} from "@grocery/shared";
import { api } from "../../../lib/api";

/** Item reads + mutations (docs/API.md → Items, Prices). */
export const itemsApi = {
  /** GET /items/:id — the item plus its price history, newest first. */
  detail: (itemId: string, signal?: AbortSignal): Promise<ItemDetail> =>
    api.get(`/items/${itemId}`, itemDetailSchema, signal),
  /** PATCH /items/:id — partial edit; `qtyText: null` clears the quantity. */
  update: (itemId: string, patch: UpdateItemRequest): Promise<Item> =>
    api.patch(`/items/${itemId}`, updateItemRequestSchema.parse(patch), itemSchema),
  /** DELETE /items/:id → 204 (EDITOR+; docs/API.md → Items). */
  remove: (itemId: string): Promise<void> => api.del(`/items/${itemId}`),
  /** POST /items/:id/image — multipart, form field "image" (docs/API.md → Items). */
  uploadImage: (itemId: string, image: Blob, filename: string) => {
    const formData = new FormData();
    formData.append("image", image, filename);
    return api.upload(`/items/${itemId}/image`, formData, itemImageResponseSchema);
  },
  /** POST /items/:id/prices → 201 observation. */
  addPrice: (
    itemId: string,
    observation: { price: number; shop: string },
  ): Promise<PriceObservation> =>
    api.post(
      `/items/${itemId}/prices`,
      createPriceObservationRequestSchema.parse(observation),
      priceObservationSchema,
    ),
  /** POST /items/:id/move — buy/unbuy toggle. */
  move: (itemId: string, status: "bought" | "to_buy"): Promise<Item> =>
    api.post(`/items/${itemId}/move`, moveItemRequestSchema.parse({ status }), itemSchema),
  /** POST /lists/:id/items/reorder → 204; the server persists sortOrder = index. */
  reorder: (listId: string, status: "TO_BUY" | "BOUGHT", orderedIds: string[]) =>
    api.postVoid(
      `/lists/${listId}/items/reorder`,
      reorderRequestSchema.parse({ status, orderedIds }),
    ),
  /** POST /lists/:id/items — plain create; never matches existing items, so it
   * always yields a separate row (duplicates included). Without `categoryId`
   * the server files the item under the list's default "Other" category. */
  create: (listId: string, request: CreateItemRequest): Promise<Item> =>
    api.post(`/lists/${listId}/items`, createItemRequestSchema.parse(request), itemSchema),
  /** GET /items/suggest?q=&listId= — grouped suggestions for the bottom input box. */
  suggest: (listId: string, q: string, signal?: AbortSignal): Promise<SuggestResponse> =>
    api.get(
      `/items/suggest?q=${encodeURIComponent(q)}&listId=${encodeURIComponent(listId)}`,
      suggestResponseSchema,
      signal,
    ),
  /** POST /lists/:id/items/smart-add — matches (BOUGHT → re-activated) or creates in "Other". */
  smartAdd: (listId: string, text: string): Promise<SmartAddResponse> =>
    api.post(
      `/lists/${listId}/items/smart-add`,
      smartAddRequestSchema.parse({ text }),
      smartAddResponseSchema,
    ),
  /** GET /search?q= — free search across the user's lists (docs/API.md → Suggest & Search);
   * its rows are the one payload mapping itemId → listId (T41 deep links). */
  search: (q: string, signal?: AbortSignal): Promise<SearchResponse> =>
    api.get(`/search?q=${encodeURIComponent(q)}`, searchResponseSchema, signal),
};
