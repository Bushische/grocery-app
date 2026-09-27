import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { useState } from "react";
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "../hooks/use-category-mutations";
import { CategoryCreateForm } from "./category-create-form";
import { CategoryList } from "./category-list";

export interface CategoryListContainerProps {
  listId: string;
  categories: Category[];
  canEdit: boolean;
  canDelete: boolean;
  onViewItems: (categoryId: string) => void;
}

/**
 * Wires the category management page to the create/update/delete mutations
 * with optimistic cache updates (docs/CONVENTIONS.md → Frontend): exactly one
 * inline editor, delete confirmation, or create form is open at a time.
 * The "Add category" affordance is persistent (docs/TASKS.md → T25) — visible
 * for EDITOR+ no matter how many categories exist, so the empty state offers
 * it too (the server forbids creating for VIEWER, so the button hides there).
 */
export function CategoryListContainer({
  listId,
  categories,
  canEdit,
  canDelete,
  onViewItems,
}: CategoryListContainerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const update = useUpdateCategory(listId);
  const remove = useDeleteCategory(listId);
  const create = useCreateCategory(listId);

  return (
    <div className="space-y-3">
      {canEdit ? (
        creating ? (
          <CategoryCreateForm
            pending={create.isPending}
            error={create.isError ? "Could not create the category. Please try again." : null}
            onCreate={(body) => create.mutate(body, { onSuccess: () => setCreating(false) })}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
            className="min-h-11 w-full rounded-lg bg-green-600 px-4 text-base font-semibold text-white transition hover:bg-green-700"
          >
            Add category
          </button>
        )
      ) : null}

      <CategoryList
        categories={categories}
        canEdit={canEdit}
        canDelete={canDelete}
        editingId={editingId}
        confirmingDeleteId={confirmingDeleteId}
        updatePending={update.isPending}
        updateError={update.isError ? "Could not save the changes. Please try again." : null}
        deletePending={remove.isPending}
        deleteError={remove.isError ? "Could not delete the category." : null}
        onStartEdit={(categoryId) => {
          setCreating(false);
          setEditingId(categoryId);
        }}
        onCancelEdit={() => setEditingId(null)}
        onSaveEdit={(categoryId, patch: UpdateCategoryRequest) =>
          update.mutate({ categoryId, patch }, { onSuccess: () => setEditingId(null) })
        }
        onStartDelete={setConfirmingDeleteId}
        onCancelDelete={() => setConfirmingDeleteId(null)}
        onConfirmDelete={(categoryId) =>
          remove.mutate(categoryId, {
            onSuccess: () => setConfirmingDeleteId(null),
          })
        }
        onViewItems={onViewItems}
      />
    </div>
  );
}
