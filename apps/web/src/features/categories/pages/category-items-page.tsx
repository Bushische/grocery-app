import type { ListRole } from "@grocery/shared";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCategories } from "../../lists/hooks/use-categories";
import { useLists } from "../../lists/hooks/use-lists";
import { CategoryAddItemInput } from "../components/category-add-item-input";
import { CategoryItemRow } from "../components/category-item-row";
import { useCategoryItems } from "../hooks/use-category-items";

/** The list context + role the category view carries from the categories page. */
export interface CategoryItemsNavigationState {
  listId?: string | null;
  role?: ListRole | null;
}

/**
 * The category's item view (docs/TASKS.md → T19): every item of the category,
 * any status, in the list's manual order. Deep links without the list context
 * still work — the header falls back to the first item's embedded category.
 *
 * T43: EDITOR+ also get the category-scoped bottom input bar (create into this
 * category, re-activate bought suggestions); the role rides on the navigation
 * state with the lists cache as fallback, and a VIEWER (or an unknown role)
 * keeps the page read-only.
 */
export function CategoryItemsPage() {
  const { categoryId = "" } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as CategoryItemsNavigationState | null;
  const listId = state?.listId ?? null;

  const lists = useLists();
  const role = state?.role ?? lists.data?.find((list) => list.id === listId)?.role ?? null;
  const canAdd = listId !== null && (role === "EDITOR" || role === "OWNER");

  const items = useCategoryItems(categoryId);
  const categories = useCategories(listId);

  const embeddedCategory = items.data?.items.at(0)?.category ?? null;
  const category = categories.data?.find((candidate) => candidate.id === categoryId) ?? null;
  const title = category?.title ?? embeddedCategory?.title ?? "Category";
  const color = category?.color ?? embeddedCategory?.color ?? null;

  return (
    <>
      <main className={`min-h-dvh bg-gray-50 px-4 pt-4 ${canAdd ? "pb-40" : "pb-16"}`}>
        <div className="mx-auto max-w-md space-y-4">
          <header className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back to the categories"
              className="min-h-11 rounded-lg px-3 text-base font-medium text-gray-700 hover:bg-gray-100"
            >
              ← Back
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {color ? (
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: color }}
                  className="h-5 w-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10"
                />
              ) : null}
              <h1 className="min-w-0 truncate text-lg font-semibold text-gray-900">{title}</h1>
            </div>
          </header>

          {items.status === "pending" ? (
            <output className="block text-sm text-gray-500">Loading items…</output>
          ) : items.status === "error" ? (
            <p role="alert" className="text-sm text-red-600">
              Could not load the items of this category.
            </p>
          ) : (items.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-500">No items in this category yet.</p>
          ) : (
            <ul aria-label="Items in this category" className="space-y-2">
              {(items.data?.items ?? []).map((item) => (
                <CategoryItemRow
                  key={item.id}
                  item={item}
                  onOpenDetails={(itemId) =>
                    // T41: the canonical details URL carries the list; when this
                    // deep-linked view has no list context, the legacy route
                    // resolves it from the item payload instead.
                    void navigate(listId ? `/lists/${listId}/items/${itemId}` : `/items/${itemId}`)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      {canAdd && listId ? (
        <div
          data-testid="add-item-bar"
          className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3"
        >
          <div className="mx-auto max-w-md">
            {/* Keyed by category: switching categories resets the input. */}
            <CategoryAddItemInput key={categoryId} listId={listId} categoryId={categoryId} />
          </div>
        </div>
      ) : null}
    </>
  );
}
