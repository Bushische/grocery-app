import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Item } from "@grocery/shared";
import { useRef, useState } from "react";
import { ApiClientError } from "../../../lib/api-client";
import { useDeleteItem } from "../hooks/use-item-detail-mutations";
import { formatAgeBadge } from "../lib/age-badge";
import { type SwipeReveal, swipeRevealForDelta } from "../lib/swipe-action";

export interface ItemRowProps {
  item: Item;
  /** Owning list — the DELETE runs through useDeleteItem(listId) (EDITOR+). */
  listId: string;
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
 * T76: swipe-to-action replaces the long-press (which fought scrolling/DnD).
 * A touch swipe on the row body reveals a real focusable button: swipe left →
 * Edit (opens details, same destination as long-press/right-click), swipe
 * right → Delete with the details-page two-step (arm `Delete X` → confirm
 * `Confirm delete X`; the 403 banner reuses the details-page wording and the
 * optimistic row removal rolls back via useDeleteItem). The pure
 * `swipeRevealForDelta` helper decides intent: horizontal wins past 40 px,
 * vertical scroll never reveals. A press that moved > 10 px (or any revealed
 * row) never toggles on its trailing click — tapping a revealed row dismisses
 * it instead. Mouse swipes never reveal; desktop right-click still opens
 * details. Drags start only from the ≡ handle (TouchSensor 150 ms / 5 px).
 */
export function ItemRow({ item, listId, sortable, onMove, onOpenDetails }: ItemRowProps) {
  const bought = item.status === "BOUGHT";
  const ageBadge = formatAgeBadge(item);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({
      id: item.id,
      disabled: !sortable,
    });

  const [revealed, setRevealed] = useState<SwipeReveal>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const movedSinceDown = useRef(false);
  const removeItem = useDeleteItem(listId);

  function handlePointerDown(event: React.PointerEvent) {
    movedSinceDown.current = false;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      startPoint.current = null;
      return;
    }
    startPoint.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: React.PointerEvent) {
    const start = startPoint.current;
    if (!start) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 10) {
      movedSinceDown.current = true;
    }
    // Touch only: mouse drags never reveal (desktop uses right-click).
    // NOTE: jsdom pointer events may carry no pointerType — only mouse is
    // excluded so touch/pen (and tests) still reveal.
    if (event.pointerType === "mouse") return;
    const next = swipeRevealForDelta(dx, dy);
    if (next !== null) {
      setRevealed(next);
      if (next !== "delete") setConfirmingDelete(false);
    }
  }

  function clearStart() {
    startPoint.current = null;
  }

  function handleTap() {
    if (revealed !== null) {
      setRevealed(null);
      setConfirmingDelete(false);
      return;
    }
    if (movedSinceDown.current) return;
    onMove(item.status === "TO_BUY" ? "bought" : "to_buy");
  }

  function handleDeleteConfirm() {
    removeItem.mutate(item.id, {
      onSuccess: () => {
        setRevealed(null);
        setConfirmingDelete(false);
      },
    });
  }

  const deleteError =
    removeItem.isError === true
      ? removeItem.error instanceof ApiClientError && removeItem.error.status === 403
        ? "You don't have permission to delete items in this list."
        : "Could not delete the item. Please try again."
      : null;

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
      {revealed === "delete" ? (
        <div className="flex shrink-0 items-center gap-1 bg-red-50 px-1">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                disabled={removeItem.isPending}
                onClick={handleDeleteConfirm}
                aria-label={`Confirm delete ${item.title}`}
                data-testid={`confirm-delete-${item.id}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removeItem.isPending ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={removeItem.isPending}
                onClick={() => {
                  setConfirmingDelete(false);
                  setRevealed(null);
                }}
                aria-label={`Cancel delete ${item.title}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${item.title}`}
              data-testid={`delete-${item.id}`}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-100"
            >
              Delete
            </button>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={clearStart}
        onPointerCancel={clearStart}
        onPointerLeave={clearStart}
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
          {revealed === "delete" && deleteError ? (
            <span role="alert" className="block text-xs text-red-600">
              {deleteError}
            </span>
          ) : null}
        </span>
        <span
          aria-label={`${item.title}: added ${ageBadge} ago`}
          className={
            bought
              ? "shrink-0 self-center rounded-full bg-gray-50 px-2 py-1 text-xs text-gray-400"
              : "shrink-0 self-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500"
          }
        >
          {ageBadge}
        </span>
      </button>
      {revealed === "edit" ? (
        <button
          type="button"
          onClick={() => onOpenDetails(item.id)}
          aria-label={`Edit ${item.title}`}
          data-testid={`edit-${item.id}`}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center bg-blue-50 px-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          Edit
        </button>
      ) : null}
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
