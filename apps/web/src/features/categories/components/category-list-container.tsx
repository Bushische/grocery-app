import type { Category, UpdateCategoryRequest } from "@grocery/shared";
import { useState } from "react";
import { useDeleteCategory, useUpdateCategory } from "../hooks/use-category-mutations";
import { CategoryList } from "./category-list";

export interface CategoryListContainerProps {
  listId: string;
  categories: Category[];
  canEdit: boolean;
  canDelete: boolean;
  onViewItems: (categoryId: string) => void;
}

/**
 * Wires the category management list to the update/delete mutations with
 * optimistic cache updates (docs/CONVENTIONS.md → Frontend): exactly one
 * inline editor or delete confirmation is open at a time.
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
  const update = useUpdateCategory(listId);
  const remove = useDeleteCategory(listId);

  return (
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
      onStartEdit={setEditingId}
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
  );
}
