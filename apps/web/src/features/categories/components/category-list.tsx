import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { CategoryEditor } from "./category-editor";

export interface CategoryListProps {
  categories: Category[];
  /** EDITOR+ may edit title/color (docs/API.md → Permissions). */
  canEdit: boolean;
  /** OWNER may delete (docs/API.md → Permissions). */
  canDelete: boolean;
  editingId: string | null;
  confirmingDeleteId: string | null;
  updatePending: boolean;
  updateError: string | null;
  deletePending: boolean;
  deleteError: string | null;
  onStartEdit: (categoryId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (categoryId: string, patch: UpdateCategoryRequest) => void;
  onStartDelete: (categoryId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (categoryId: string) => void;
  onViewItems: (categoryId: string) => void;
}

/**
 * The category management list (docs/TASKS.md → T19): color swatch, title,
 * item count, link to the filtered item view, inline edit, and delete —
 * delete is disabled while items still reference the category (the server
 * would answer 409, docs/API.md → Categories).
 */
export function CategoryList({
  categories,
  canEdit,
  canDelete,
  editingId,
  confirmingDeleteId,
  updatePending,
  updateError,
  deletePending,
  deleteError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onViewItems,
}: CategoryListProps) {
  return (
    <div className="space-y-2">
      {deleteError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </p>
      ) : null}
      <ul aria-label="Categories" className="space-y-2">
        {categories.map((category) => {
          const deleteBlocked = category.itemCount > 0;
          return (
            <li
              key={category.id}
              data-testid={`category-row-${category.id}`}
              className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200"
            >
              {editingId === category.id ? (
                <CategoryEditor
                  category={category}
                  pending={updatePending}
                  error={updateError}
                  onSave={(patch) => onSaveEdit(category.id, patch)}
                  onCancel={onCancelEdit}
                />
              ) : (
                <div className="flex items-center gap-1 p-2">
                  <button
                    type="button"
                    onClick={() => onViewItems(category.id)}
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
                      onClick={() => onStartEdit(category.id)}
                      aria-label={`Edit ${category.title}`}
                      className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                    >
                      Edit
                    </button>
                  ) : null}
                  {canDelete ? (
                    confirmingDeleteId === category.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onConfirmDelete(category.id)}
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
                        onClick={() => onStartDelete(category.id)}
                        disabled={deleteBlocked}
                        title={deleteBlocked ? "Reassign or delete its items first" : undefined}
                        aria-label={`Delete ${category.title}`}
                        className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Delete
                      </button>
                    )
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {categories.length === 0 ? <p className="text-sm text-gray-500">No categories yet.</p> : null}
    </div>
  );
}
