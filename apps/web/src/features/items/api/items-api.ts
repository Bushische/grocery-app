import {
  type Item,
  type SmartAddResponse,
  type SuggestResponse,
  itemSchema,
  moveItemRequestSchema,
  reorderRequestSchema,
  smartAddRequestSchema,
  smartAddResponseSchema,
  suggestResponseSchema,
} from "@grocery/shared";
import { api } from "../../../lib/api";

/** Item mutations for the main screen (docs/API.md → Items: move, reorder). */
export const itemsApi = {
  /** POST /items/:id/move — buy/unbuy toggle. */
  move: (itemId: string, status: "bought" | "to_buy"): Promise<Item> =>
    api.post(`/items/${itemId}/move`, moveItemRequestSchema.parse({ status }), itemSchema),
  /** POST /lists/:id/items/reorder → 204; the server persists sortOrder = index. */
  reorder: (listId: string, status: "TO_BUY" | "BOUGHT", orderedIds: string[]) =>
    api.postVoid(
      `/lists/${listId}/items/reorder`,
      reorderRequestSchema.parse({ status, orderedIds }),
    ),
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
};
