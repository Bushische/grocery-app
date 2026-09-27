import {
  type Item,
  itemSchema,
  moveItemRequestSchema,
  reorderRequestSchema,
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
};
