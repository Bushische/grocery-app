import type { Item } from "@grocery/shared";
import { useNavigate } from "react-router-dom";
import { ItemSections } from "../components/item-sections";
import { useMoveItem, useReorderItems } from "../hooks/use-item-mutations";

export interface ItemSectionsContainerProps {
  listId: string;
  toBuy: Item[];
  bought: Item[];
}

/**
 * Wires the main screen's item sections to the move/reorder mutations with
 * optimistic updates (docs/CONVENTIONS.md → Frontend), toggles status on a
 * whole-row tap (T27), and navigates to the (T18) details page on long-press /
 * right-click. T41: details open at the canonical `/lists/:listId/items/:id`
 * — the owning list rides in the URL, never in navigation state.
 */
export function ItemSectionsContainer({ listId, toBuy, bought }: ItemSectionsContainerProps) {
  const navigate = useNavigate();
  const move = useMoveItem(listId);
  const reorder = useReorderItems(listId);

  return (
    <ItemSections
      toBuy={toBuy}
      bought={bought}
      onReorder={(orderedIds) => reorder.mutate(orderedIds)}
      onMove={(itemId, status) => move.mutate({ itemId, status })}
      onOpenDetails={(itemId) => void navigate(`/lists/${listId}/items/${itemId}`)}
    />
  );
}
