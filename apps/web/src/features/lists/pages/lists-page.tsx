import { useState } from "react";
import { useLogout } from "../../auth/hooks/use-logout";
import { useSession } from "../../auth/hooks/use-session";
import { CreateListForm } from "../components/create-list-form";
import { DeleteListButton } from "../components/delete-list-button";
import { ListTabs } from "../components/list-tabs";
import { useItems } from "../hooks/use-items";
import { useCreateList, useDeleteList, useLists } from "../hooks/use-lists";

const GENERIC_CREATE_ERROR = "Could not create the list. Please try again.";

/**
 * Lists view (docs/TASKS.md → T15): select (tabs), create, and delete lists —
 * delete offered to the selected list's OWNER only. The selected list's items
 * are fetched per list (refetched on every switch); T16 rebuilds this panel as
 * the full mobile screen with drag-and-drop.
 */
export function ListsPage() {
  const { user } = useSession();
  const lists = useLists();
  const logout = useLogout();
  const createList = useCreateList();
  const deleteList = useDeleteList();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const listsData = lists.data ?? [];
  // Falls back to the first list — covers initial load and deleting the selected list.
  const selectedList = listsData.find((list) => list.id === selectedId) ?? listsData[0] ?? null;
  const items = useItems(selectedList?.id ?? null);

  const toBuy = (items.data?.items ?? []).filter((item) => item.status === "TO_BUY");
  const bought = (items.data?.items ?? []).filter((item) => item.status === "BOUGHT");

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-semibold text-gray-900">My Groceries</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {lists.status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading lists…</output>
        ) : lists.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            Could not load your lists.
          </p>
        ) : (
          <>
            <ListTabs
              lists={listsData}
              selectedId={selectedList?.id ?? null}
              onSelect={(id) => {
                setSelectedId(id);
                setShowCreateForm(false);
              }}
              onCreate={() => setShowCreateForm((open) => !open)}
            />

            {showCreateForm ? (
              <CreateListForm
                pending={createList.isPending}
                error={createList.isError ? GENERIC_CREATE_ERROR : null}
                onSubmit={(values) =>
                  createList.mutate(values.title, {
                    onSuccess: (created) => {
                      setShowCreateForm(false);
                      setSelectedId(created.id);
                    },
                  })
                }
                onCancel={() => setShowCreateForm(false)}
              />
            ) : null}

            {selectedList ? (
              <section
                id="list-panel"
                role="tabpanel"
                aria-labelledby={`tab-${selectedList.id}`}
                className="mt-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-gray-500">
                    {selectedList.itemCounts.toBuy} to buy · {selectedList.itemCounts.bought} bought
                  </p>
                  {selectedList.role === "OWNER" ? (
                    <DeleteListButton
                      key={selectedList.id}
                      pending={deleteList.isPending}
                      onConfirm={() => deleteList.mutate(selectedList.id)}
                    />
                  ) : null}
                </div>

                {items.status === "pending" ? (
                  <output className="mt-4 block text-sm text-gray-500">Loading items…</output>
                ) : items.status === "error" ? (
                  <p role="alert" className="mt-4 text-sm text-red-600">
                    Could not load the items of this list.
                  </p>
                ) : (
                  <div className="mt-4 space-y-6">
                    <section aria-label="To buy">
                      <h2 className="text-sm font-semibold text-gray-900">To buy</h2>
                      {toBuy.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">No items to buy.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {toBuy.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-gray-200"
                            >
                              {item.title}
                              {item.qtyText ? ` · ${item.qtyText}` : ""} · {item.daysInList}d
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section aria-label="Bought">
                      <h2 className="text-sm font-semibold text-gray-900">Bought</h2>
                      {bought.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-500">Nothing bought yet.</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {bought.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-lg bg-white px-3 py-2 text-gray-500 line-through shadow-sm ring-1 ring-gray-200"
                            >
                              {item.title}
                              {item.qtyText ? ` · ${item.qtyText}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                )}
              </section>
            ) : listsData.length === 0 ? (
              <p className="mt-6 text-sm text-gray-500">
                No lists yet — create one with the + button.
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
