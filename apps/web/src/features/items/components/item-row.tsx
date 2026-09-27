import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@grocery/shared";
import { useLongPress } from "../hooks/use-long-press";

export interface ItemRowProps {
  item: Item;
  /** TO_BUY rows get a drag handle (≡) and register with the sortable context. */
  sortable: boolean;
  onMove: (status: "bought" | "to_buy") => void;
  onOpenDetails: (itemId: string) => void;
  movePending?: boolean;
}

/**
 * One list row per docs/PROJECT.md → UX: left vertical category color bar,
 * title, optional quantity text, "3d" badge, and (TO_BUY only) a ≡ drag handle.
 * Dragging starts only from the handle (TouchSensor: 150 ms delay, 5 px
 * tolerance — configured by the surrounding DndContext); long-press (500 ms) /
 * right-click on the row body opens the item details; the Buy/Unbuy button is
 * its own ≥ 40 px touch target.
 */
export function ItemRow({
  item,
  sortable,
  onMove,
  onOpenDetails,
  movePending = false,
}: ItemRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({
      id: item.id,
      disabled: !sortable,
    });
  const longPress = useLongPress(() => onOpenDetails(item.id));

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }}
      className="flex items-stretch overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200"
      data-testid={`item-row-${item.id}`}
    >
      <div
        {...longPress}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenDetails(item.id);
        }}
        className="flex min-h-11 flex-1 items-stretch"
      >
        <span
          aria-hidden="true"
          className="w-1.5 shrink-0 self-stretch"
          style={{ backgroundColor: item.category.color }}
        />
        <span className="min-w-0 flex-1 py-2.5 pl-3">
          <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
          {item.qtyText ? (
            <span className="block text-xs text-gray-500">{item.qtyText}</span>
          ) : null}
        </span>
        <span
          aria-label={`${item.title}: ${item.daysInList} days in list`}
          className="shrink-0 self-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500"
        >
          {item.daysInList}d
        </span>
      </div>
      <button
        type="button"
        onClick={() => onMove(item.status === "TO_BUY" ? "bought" : "to_buy")}
        disabled={movePending}
        aria-label={
          item.status === "TO_BUY"
            ? `Mark ${item.title} as bought`
            : `Move ${item.title} back to to buy`
        }
        className="min-h-11 min-w-11 shrink-0 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        {item.status === "TO_BUY" ? "Buy" : "Unbuy"}
      </button>
      {sortable ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${item.title}`}
          data-testid={`handle-${item.id}`}
          className="flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center text-gray-400 hover:bg-gray-50"
        >
          ≡
        </button>
      ) : null}
    </li>
  );
}
