import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item } from "@grocery/shared";
import { ItemRow } from "./item-row";

/**
 * Maps a drag (active id → over id) to the new TO_BUY order. Pure, so the
 * drag-end wiring can be unit-tested without jsdom layout (no real drags).
 */
export function reorderedIdsAfterDrag(
  ids: string[],
  activeId: string,
  overId: string,
): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || activeId === overId) return null;
  return arrayMove(ids, from, to);
}

export interface ItemSectionsProps {
  toBuy: Item[];
  bought: Item[];
  onReorder: (orderedIds: string[]) => void;
  onMove: (itemId: string, status: "bought" | "to_buy") => void;
  onOpenDetails: (itemId: string) => void;
}

/**
 * The main screen's two sections (docs/PROJECT.md → UX): "to buy" on top with
 * drag-and-drop reordering, "bought" below. Dragging is allowed only via the ≡
 * handle: TouchSensor (150 ms delay, 5 px tolerance) + MouseSensor, never a
 * plain pointer drag of the row body — that is reserved for long-press details.
 * Tapping the row body toggles the item's status (T27).
 */
export function ItemSections({
  toBuy,
  bought,
  onReorder,
  onMove,
  onOpenDetails,
}: ItemSectionsProps) {
  // 150 ms delay / 5 px tolerance per docs/PROJECT.md; mouse drags need a small
  // distance so a click never starts a drag; keyboard offers an a11y fallback.
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const next = reorderedIdsAfterDrag(
      toBuy.map((item) => item.id),
      String(active.id),
      String(over.id),
    );
    if (next) {
      onReorder(next);
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="To buy">
        <h2 className="text-sm font-semibold text-gray-900">To buy</h2>
        {toBuy.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No items to buy.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={toBuy.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="mt-2 space-y-2">
                {toBuy.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    sortable
                    onMove={(status) => onMove(item.id, status)}
                    onOpenDetails={onOpenDetails}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
      <section aria-label="Bought">
        <h2 className="text-sm font-semibold text-gray-900">Bought</h2>
        {bought.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing bought yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {bought.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                sortable={false}
                onMove={(status) => onMove(item.id, status)}
                onOpenDetails={onOpenDetails}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
