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
}

/**
 * One list row per docs/PROJECT.md → UX: left vertical category color bar,
 * title, optional quantity text, "3d" badge, and (TO_BUY only) a ≡ drag handle.
 *
 * T36: BOUGHT rows follow the "Buy Me a Pie" convention — strikethrough title,
 * muted gray content, desaturated color bar, and a dimmed row — while TO_BUY
 * rows keep the normal look; interactions are unaffected.
 *
 * T27: the whole row body is the toggle — tapping it moves the item
 * (TO_BUY → BOUGHT / BOUGHT → TO_BUY via `POST /items/:id/move`); the dedicated
 * Buy/Unbuy button is gone. Gesture disambiguation: drags start only from the ≡
 * handle (TouchSensor: 150 ms delay, 5 px tolerance — configured by the
 * surrounding DndContext), a long-press (500 ms) / right-click on the row body
 * opens the item details instead, and a press that moved > 10 px was a scroll —
 * its trailing click never toggles. The handle itself is drag-only: a tap on it
 * is a failed drag attempt, never a toggle.
 */
export function ItemRow({ item, sortable, onMove, onOpenDetails }: ItemRowProps) {
  const bought = item.status === "BOUGHT";
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({
      id: item.id,
      disabled: !sortable,
    });
  const { movedSinceDown, ...pressHandlers } = useLongPress(() => onOpenDetails(item.id));

  function handleTap() {
    if (movedSinceDown.current) return;
    onMove(item.status === "TO_BUY" ? "bought" : "to_buy");
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : bought ? 0.7 : undefined,
      }}
      className="flex items-stretch overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200"
      data-testid={`item-row-${item.id}`}
    >
      <button
        type="button"
        {...pressHandlers}
        onClick={handleTap}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenDetails(item.id);
        }}
        aria-label={
          item.status === "TO_BUY"
            ? `Mark ${item.title} as bought`
            : `Move ${item.title} back to to buy`
        }
        data-testid={`row-body-${item.id}`}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-stretch text-left"
      >
        <span
          aria-hidden="true"
          className={
            bought
              ? "w-1.5 shrink-0 self-stretch opacity-50 grayscale"
              : "w-1.5 shrink-0 self-stretch"
          }
          style={{ backgroundColor: item.category.color }}
        />
        <span className="min-w-0 flex-1 py-2.5 pl-3">
          <span
            className={
              bought
                ? "block truncate text-sm font-medium text-gray-400 line-through"
                : "block truncate text-sm font-medium text-gray-900"
            }
          >
            {item.title}
          </span>
          {item.qtyText ? (
            <span
              className={bought ? "block text-xs text-gray-400" : "block text-xs text-gray-500"}
            >
              {item.qtyText}
            </span>
          ) : null}
        </span>
        <span
          aria-label={`${item.title}: ${item.daysInList} days in list`}
          className={
            bought
              ? "shrink-0 self-center rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-400"
              : "shrink-0 self-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500"
          }
        >
          {item.daysInList}d
        </span>
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
