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
import { groupAwareReorderedIds, groupSectionItems } from "../lib/grouping";
import { ItemRow } from "./item-row";

export { groupAwareReorderedIds };

/**
 * Maps a drag (active id → over id) to the new TO_BUY order. Pure, so the
 * drag-end wiring can be unit-tested without jsdom layout (no real drags).
 * Kept for compatibility (T16); new code uses {@link groupAwareReorderedIds}.
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

/**
 * Torn-receipt zigzag divider between the TO_BUY and BOUGHT sections (T83):
 * pure CSS triangles, decorative.
 */
function TornSeparator() {
  return (
    <div
      aria-hidden="true"
      data-testid="receipt-separator"
      className="h-3"
      style={{
        background:
          "linear-gradient(135deg, rgb(229 231 235) 8px, transparent 0) 0 0 / 16px 16px repeat-x, " +
          "linear-gradient(225deg, rgb(229 231 235) 8px, transparent 0) 0 0 / 16px 16px repeat-x",
      }}
    />
  );
}

export interface ItemSectionsProps {
  listId: string;
  toBuy: Item[];
  bought: Item[];
  onReorder: (status: "TO_BUY" | "BOUGHT", orderedIds: string[]) => void;
  onMove: (itemId: string, status: "bought" | "to_buy") => void;
  onOpenDetails: (itemId: string) => void;
}

/**
 * The main screen's two sections (T75 + T83): TO_BUY renders grouped by
 * category (groups ordered by first-item position, items by sortOrder) with
 * drag-and-drop via the ≡ handle only (TouchSensor 150 ms delay / 5 px
 * tolerance + MouseSensor, never a plain row-body drag). Inside-group drops
 * reorder within the run; cross-group drops move the dragged item to the top
 * of its group and its whole block above the target's group
 * (see groupAwareReorderedIds). BOUGHT is a flat freshly-bought-first list
 * (no grouping, no handles) on a grey wash under a torn-receipt divider.
 * Tapping a row body toggles status (T27). The "To buy" header carries the
 * client-derived count (T39).
 */
export function ItemSections({
  listId,
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
    const next = groupAwareReorderedIds(toBuyOrdered, String(active.id), String(over.id));
    if (next) {
      onReorder("TO_BUY", next);
    }
  }

  const toBuyGroups = groupSectionItems(toBuy);
  const toBuyOrdered = toBuyGroups.flatMap((group) => group.items);

  return (
    <div className="space-y-6">
      <section aria-label="To buy">
        {/* T39: the count is derived from the loaded items cache (the `toBuy`
            prop) — optimistic move/create/delete cache updates recompute it in
            the same frame as the rows; no server round-trip is involved. */}
        <h2 className="text-sm font-semibold text-gray-900">To buy ({toBuy.length})</h2>
        {toBuy.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No items to buy.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={toBuyOrdered.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="mt-2 space-y-4">
                {toBuyGroups.map((group) => (
                  <div key={group.category.id}>
                    <h3
                      data-testid={`group-to_buy-${group.category.id}`}
                      className="flex items-center gap-2 text-xs font-medium text-gray-500"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: group.category.color }}
                      />
                      {group.category.title}
                    </h3>
                    <ul className="mt-1 space-y-2">
                      {group.items.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          listId={listId}
                          sortable
                          onMove={(status) => onMove(item.id, status)}
                          onOpenDetails={onOpenDetails}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>
      <TornSeparator />
      <section aria-label="Bought" className="rounded-xl bg-gray-100 p-3">
        <h2 className="text-sm font-semibold text-gray-900">Bought</h2>
        {bought.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Nothing bought yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {bought.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                listId={listId}
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
