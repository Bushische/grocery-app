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
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { CategoryEditor } from "./category-editor";

export interface CategoryListProps {
  categories: Category[];
  /** EDITOR+ may edit title/color (docs/API.md → Permissions). */
  canEdit: boolean;
  /** OWNER may delete (docs/API.md → Permissions). */
  canDelete: boolean;
  /** EDITOR+ may reorder via the ≡ handle (VIEWER sees none, docs/TASKS.md → T94). */
  canReorder: boolean;
  editingId: string | null;
  confirmingDeleteId: string | null;
  updatePending: boolean;
  updateError: string | null;
  deletePending: boolean;
  deleteError: string | null;
  /** Reorder failure banner (the optimistic order rolls back, docs/TASKS.md → T94). */
  reorderError: string | null;
  onStartEdit: (categoryId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (categoryId: string, patch: UpdateCategoryRequest) => void;
  onStartDelete: (categoryId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (categoryId: string) => void;
  onViewItems: (categoryId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

/**
 * Maps a drag (active id → over id) to the new category order. Pure, so the
 * drag-end wiring can be unit-tested without jsdom layout (no real drags) —
 * the same pattern as the item rows (item-sections.tsx → reorderedIdsAfterDrag).
 */
export function reorderedCategoryIdsAfterDrag(
  ids: string[],
  activeId: string,
  overId: string,
): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || activeId === overId) return null;
  return arrayMove(ids, from, to);
}

interface CategoryRowItemProps {
  category: Category;
  /** Drag handle (≡) + sortable registration, EDITOR+ only. */
  sortable: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  updatePending: boolean;
  updateError: string | null;
  deletePending: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (patch: UpdateCategoryRequest) => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onViewItems: () => void;
}

/**
 * One category row: tapping the body opens the filtered items view; drags
 * start only from the ≡ handle (TouchSensor 150 ms / 5 px, like the item
 * rows) so taps never reorder.
 */
function CategoryRowItem({
  category,
  sortable,
  canEdit,
  canDelete,
  editing,
  confirmingDelete,
  updatePending,
  updateError,
  deletePending,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onViewItems,
}: CategoryRowItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({ id: category.id, disabled: !sortable });
  const deleteBlocked = category.itemCount > 0;

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }}
      data-testid={`category-row-${category.id}`}
      className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200"
    >
      {editing ? (
        <CategoryEditor
          category={category}
          pending={updatePending}
          error={updateError}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <div className="flex items-center gap-1 p-2">
          <button
            type="button"
            onClick={onViewItems}
            aria-label={`View items in ${category.title}`}
            className="flex min-h-11 flex-1 items-center gap-3 rounded-lg px-2 text-left hover:bg-gray-50"
          >
            <span
              aria-hidden="true"
              data-testid={`category-swatch-${category.id}`}
              style={{ backgroundColor: category.color }}
              className="h-9 w-9 shrink-0 rounded-md ring-1 ring-inset ring-black/10"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">
                {category.title}
              </span>
              <span className="block text-xs text-gray-500">
                {category.itemCount} {category.itemCount === 1 ? "item" : "items"}
              </span>
            </span>
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={onStartEdit}
              aria-label={`Edit ${category.title}`}
              className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Edit
            </button>
          ) : null}
          {canDelete ? (
            confirmingDelete ? (
              <>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={deletePending}
                  aria-label={`Confirm delete ${category.title}`}
                  className="min-h-11 shrink-0 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletePending ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={deletePending}
                  aria-label={`Cancel deleting ${category.title}`}
                  className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onStartDelete}
                disabled={deleteBlocked}
                title={deleteBlocked ? "Reassign or delete its items first" : undefined}
                aria-label={`Delete ${category.title}`}
                className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            )
          ) : null}
          {sortable ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${category.title}`}
              data-testid={`handle-${category.id}`}
              className="flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50"
            >
              ≡
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/**
 * The category management list (docs/TASKS.md → T19): color swatch, title,
 * item count, link to the filtered item view, inline edit, and delete —
 * delete is disabled while items still reference the category (the server
 * would answer 409, docs/API.md → Categories).
 *
 * T94: EDITOR+ rows reorder via the ≡ handle on the right (like the item
 * rows); VIEWER sees no handles and issues no reorder calls.
 */
export function CategoryList({
  categories,
  canEdit,
  canDelete,
  canReorder,
  editingId,
  confirmingDeleteId,
  updatePending,
  updateError,
  deletePending,
  deleteError,
  reorderError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onViewItems,
  onReorder,
}: CategoryListProps) {
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
    const next = reorderedCategoryIdsAfterDrag(
      categories.map((category) => category.id),
      String(active.id),
      String(over.id),
    );
    if (next) {
      onReorder(next);
    }
  }

  function rowProps(category: Category) {
    return {
      category,
      sortable: canReorder,
      canEdit,
      canDelete,
      editing: editingId === category.id,
      confirmingDelete: confirmingDeleteId === category.id,
      updatePending,
      updateError,
      deletePending,
      onStartEdit: () => onStartEdit(category.id),
      onCancelEdit,
      onSaveEdit: (patch: UpdateCategoryRequest) => onSaveEdit(category.id, patch),
      onStartDelete: () => onStartDelete(category.id),
      onCancelDelete,
      onConfirmDelete: () => onConfirmDelete(category.id),
      onViewItems: () => onViewItems(category.id),
    };
  }

  return (
    <div className="space-y-2">
      {deleteError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </p>
      ) : null}
      {reorderError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {reorderError}
        </p>
      ) : null}
      {canReorder ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={categories.map((category) => category.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul aria-label="Categories" className="space-y-2">
              {categories.map((category) => (
                <CategoryRowItem key={category.id} {...rowProps(category)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul aria-label="Categories" className="space-y-2">
          {categories.map((category) => (
            <CategoryRowItem key={category.id} {...rowProps(category)} />
          ))}
        </ul>
      )}
      {categories.length === 0 ? <p className="text-sm text-gray-500">No categories yet.</p> : null}
    </div>
  );
}
