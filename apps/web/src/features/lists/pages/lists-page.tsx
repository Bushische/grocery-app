import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogout } from "../../auth/hooks/use-logout";
import { useSession } from "../../auth/hooks/use-session";
import type { CategoriesNavigationState } from "../../categories/pages/categories-page";
import { AddItemInput } from "../../items/components/add-item-input";
import { ItemSectionsContainer } from "../../items/components/item-sections-container";
import type { MembersNavigationState } from "../../members/pages/members-page";
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
  const navigate = useNavigate();
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

      <main className="mx-auto max-w-md px-4 pb-40 pt-4">
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
                  <div className="flex items-center gap-2">
                    {selectedList.role === "OWNER" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void navigate(`/lists/${selectedList.id}/members`, {
                            state: { role: selectedList.role } satisfies MembersNavigationState,
                          })
                        }
                        className="min-h-10 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                      >
                        Members
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        void navigate(`/lists/${selectedList.id}/categories`, {
                          state: { role: selectedList.role } satisfies CategoriesNavigationState,
                        })
                      }
                      className="min-h-10 rounded-lg px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                    >
                      Categories
                    </button>
                    {selectedList.role === "OWNER" ? (
                      <DeleteListButton
                        key={selectedList.id}
                        pending={deleteList.isPending}
                        onConfirm={() => deleteList.mutate(selectedList.id)}
                      />
                    ) : null}
                  </div>
                </div>

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
              <p className="mt-6 text-sm text-gray-500">
                No lists yet — create one with the + button.
              </p>
            ) : null}
          </>
        )}
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
