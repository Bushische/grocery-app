import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCategories } from "../../lists/hooks/use-categories";
import { CategoryItemRow } from "../components/category-item-row";
import { useCategoryItems } from "../hooks/use-category-items";

/** The list context the item details page needs for its category select (T18). */
export interface CategoryItemsNavigationState {
  listId?: string | null;
}

/**
 * The category's item view (docs/TASKS.md → T19): every item of the category,
 * any status, in the list's manual order. Deep links without the list context
 * still work — the header falls back to the first item's embedded category.
 */
export function CategoryItemsPage() {
  const { categoryId = "" } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const listId = (location.state as CategoryItemsNavigationState | null)?.listId ?? null;

  const items = useCategoryItems(categoryId);
  const categories = useCategories(listId);

  const embeddedCategory = items.data?.items.at(0)?.category ?? null;
  const category = categories.data?.find((candidate) => candidate.id === categoryId) ?? null;
  const title = category?.title ?? embeddedCategory?.title ?? "Category";
  const color = category?.color ?? embeddedCategory?.color ?? null;

  return (
    <main className="min-h-dvh bg-gray-50 px-4 pb-16 pt-4">
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
                  void navigate(`/items/${itemId}`, {
                    state: { listId } satisfies CategoryItemsNavigationState,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
