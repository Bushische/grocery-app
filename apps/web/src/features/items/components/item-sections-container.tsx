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
 * optimistic updates (docs/CONVENTIONS.md → Frontend) and navigates to the
 * (T18) details page on long-press / right-click.
 */
export function ItemSectionsContainer({ listId, toBuy, bought }: ItemSectionsContainerProps) {
  const navigate = useNavigate();
  const move = useMoveItem(listId);
  const reorder = useReorderItems(listId);

  return (
    <ItemSections
      toBuy={toBuy}
      bought={bought}
      movePending={move.isPending}
      onReorder={(orderedIds) => reorder.mutate(orderedIds)}
      onMove={(itemId, status) => move.mutate({ itemId, status })}
      onOpenDetails={(itemId) => void navigate(`/items/${itemId}`)}
    />
  );
}
