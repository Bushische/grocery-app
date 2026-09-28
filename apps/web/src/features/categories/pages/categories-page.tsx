import type { ListRole } from "@grocery/shared";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCategories } from "../../lists/hooks/use-categories";
import { useLists } from "../../lists/hooks/use-lists";
import { CategoryListContainer } from "../components/category-list-container";
import type { CategoryItemsNavigationState } from "./category-items-page";

/** The list context the categories page carries into the filtered item view. */
export interface CategoriesNavigationState {
  role?: ListRole;
}

/**
 * Category management page (docs/TASKS.md → T19): per-list categories with
 * color swatch, title, item counts, link to the filtered item view, edit
 * (EDITOR+), and delete (OWNER, blocked while items are assigned). The user's
 * role rides on the navigation state of the main screen's "Categories" button;
 * deep links degrade to a read-only list (the lists cache fills the role in
 * when it is warm).
 */
export function CategoriesPage() {
  const { listId = "" } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const lists = useLists();
  const categories = useCategories(listId);

  const stateRole = (location.state as CategoriesNavigationState | null)?.role ?? null;
  const role = stateRole ?? lists.data?.find((list) => list.id === listId)?.role ?? null;
  const canEdit = role === "EDITOR" || role === "OWNER";
  const canDelete = role === "OWNER";
  const listTitle = lists.data?.find((list) => list.id === listId)?.title ?? null;

  return (
    <main className="min-h-dvh bg-gray-50 px-4 pb-16 pt-4">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back to the list"
            className="min-h-11 rounded-lg px-3 text-base font-medium text-gray-700 hover:bg-gray-100"
          >
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-gray-900">Categories</h1>
            {listTitle ? <p className="truncate text-sm text-gray-500">{listTitle}</p> : null}
          </div>
        </header>

        {categories.status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading categories…</output>
        ) : categories.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            Could not load the categories.
          </p>
        ) : (
          <CategoryListContainer
            listId={listId}
            categories={categories.data ?? []}
            canEdit={canEdit}
            canDelete={canDelete}
            onViewItems={(categoryId) =>
              void navigate(`/categories/${categoryId}`, {
                // T43: the role rides along so the category view can show its
                // scoped add-input bar to EDITOR+ (VIEWER stays read-only).
                state: { listId, role } satisfies CategoryItemsNavigationState,
              })
            }
          />
        )}
      </div>
    </main>
  );
}
