import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AddItemInput } from "../../items/components/add-item-input";
import { ItemSectionsContainer } from "../../items/components/item-sections-container";
import { AppMenu } from "../components/app-menu";
import { useItems } from "../hooks/use-items";
import { useLists } from "../hooks/use-lists";

/**
 * Main screen (docs/TASKS.md → T30 UX redesign): exactly one header line —
 * the current list's name plus the menu button; every list/account/admin
 * action lives in the overlay menu. T41: the selected list lives in the URL
 * (`/lists/:listId`) — no component state — so Back/reload/deep links land on
 * the same list; bare `/` and stale ids resolve to the first list.
 */
export function ListsPage() {
  const { listId } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const lists = useLists();

  const listsData = lists.data ?? [];
  // The route param is the only selection source; unknown ids (deleted list,
  // foreign deep link) fall through to the redirect below.
  const selectedList = listId ? (listsData.find((list) => list.id === listId) ?? null) : null;
  const items = useItems(selectedList?.id ?? null);

  // `/` and stale ids resolve to the first list — replace, so Back/refresh
  // never resurrect a dead selection. A no-lists user just stays put.
  useEffect(() => {
    if (!lists.isSuccess || selectedList) return;
    const first = listsData[0];
    if (first) navigate(`/lists/${first.id}`, { replace: true });
  }, [lists.isSuccess, selectedList, listsData, navigate]);

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">
          {selectedList?.title ?? "My Groceries"}
        </h1>
        <AppMenu selectedList={selectedList} />
      </header>

      <main className="mx-auto max-w-md px-4 pb-40 pt-4">
        {lists.status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading lists…</output>
        ) : lists.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            Could not load your lists.
          </p>
        ) : selectedList ? (
          <section id="list-panel" data-testid="list-panel" className="mt-1">
            {/* The old server-counts line was removed (T39): the "To buy"
                section header below renders the count client-side from the
                loaded items cache; `itemCounts` stays in /lists for the menu's
                list switcher. */}

            {items.status === "pending" ? (
              <output className="mt-4 block text-sm text-gray-500">Loading items…</output>
            ) : items.status === "error" ? (
              <p role="alert" className="mt-4 text-sm text-red-600">
                Could not load the items of this list.
              </p>
            ) : (
              <div className="mt-4">
                <ItemSectionsContainer
                  listId={selectedList.id}
                  toBuy={(items.data?.items ?? []).filter((item) => item.status === "TO_BUY")}
                  bought={(items.data?.items ?? []).filter((item) => item.status === "BOUGHT")}
                />
              </div>
            )}
          </section>
        ) : listsData.length === 0 ? (
          <p className="mt-6 text-sm text-gray-500">No lists yet — create one from the menu.</p>
        ) : null}
      </main>

      {selectedList ? (
        <div
          data-testid="add-item-bar"
          className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3"
        >
          <div className="mx-auto max-w-md">
            {/* Keyed by list: switching lists resets the input and its suggestions. */}
            <AddItemInput key={selectedList.id} listId={selectedList.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
