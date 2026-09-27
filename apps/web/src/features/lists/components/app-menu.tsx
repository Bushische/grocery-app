import type { ListSummary } from "@grocery/shared";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogout } from "../../auth/hooks/use-logout";
import { useSession } from "../../auth/hooks/use-session";
import type { CategoriesNavigationState } from "../../categories/pages/categories-page";
import type { MembersNavigationState } from "../../members/pages/members-page";
import { useCreateList, useDeleteList, useLists, useUpdateList } from "../hooks/use-lists";
import { CreateListForm } from "./create-list-form";
import { DeleteListButton } from "./delete-list-button";
import { RenameListForm } from "./rename-list-form";

const GENERIC_CREATE_ERROR = "Could not create the list. Please try again.";
const GENERIC_DELETE_ERROR = "Could not delete the list. Please try again.";
const GENERIC_RENAME_ERROR = "Could not rename the list. Please try again.";

const blockHeadingClass = "px-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400";
const rowBaseClass =
  "flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-medium text-gray-800 " +
  "transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-600";
const roleBadgeClass =
  "shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500";

interface AppMenuProps {
  /** The list the main screen currently shows (null = none selected / none exists). */
  selectedList: ListSummary | null;
}

/**
 * Single-line-header companion (docs/TASKS.md → T30): the hamburger opens an
 * overlay menu (drawer over the content) holding everything the old stacked
 * header and the list-controls row used to — account (email + sign out), list
 * management (switcher, create, OWNER-only rename + delete, Categories,
 * OWNER-only Members, per-list roles as before) and the admin tools ("Users
 * management" → the T32 page, admins only). Closes on selection, Escape, and
 * backdrop tap; rows are ≥ 40 px touch targets. T41: switching lists is a
 * navigation to `/lists/:listId` — the URL owns the selection.
 */
export function AppMenu({ selectedList }: AppMenuProps) {
  const { user } = useSession();
  const lists = useLists();
  const logout = useLogout();
  const createList = useCreateList();
  const deleteList = useDeleteList();
  const renameList = useUpdateList();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRenameForm, setShowRenameForm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Restore focus to the trigger — the overlay that held focus is unmounting.
    triggerRef.current?.focus();
  }, []);

  const selectAndClose = (id: string) => {
    setShowCreateForm(false);
    setShowRenameForm(false);
    close();
    void navigate(`/lists/${id}`);
  };

  const listsData = lists.data ?? [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setShowRenameForm(false);
          setOpen(true);
        }}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <MenuOverlay onClose={close}>
          <section aria-label="Account" className="border-b border-gray-200 py-3">
            <h2 className={blockHeadingClass}>Account</h2>
            <p
              data-testid="menu-user-email"
              className="truncate px-4 py-1 text-sm font-medium text-gray-900"
            >
              {user?.email ?? "Signed out"}
            </p>
            <button
              type="button"
              onClick={() => {
                close();
                logout.mutate();
              }}
              className={`${rowBaseClass} text-red-600 hover:bg-red-50`}
            >
              Sign out
            </button>
          </section>

          <section aria-label="Lists" className="border-b border-gray-200 py-3">
            <h2 className={blockHeadingClass}>Lists</h2>
            {listsData.length === 0 ? (
              <p className="px-4 py-2 text-sm text-gray-500">No lists yet — create one below.</p>
            ) : (
              <ul className="pb-1">
                {listsData.map((list) => {
                  const selected = list.id === selectedList?.id;
                  return (
                    <li key={list.id}>
                      <button
                        type="button"
                        onClick={() => selectAndClose(list.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`${rowBaseClass} ${selected ? "bg-green-50 text-green-800" : ""}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{list.title}</span>
                        <span className={roleBadgeClass}>{list.role}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="px-4 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm((visible) => !visible)}
                className="min-h-11 w-full rounded-lg bg-green-600 px-4 text-sm font-semibold text-white hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              >
                New list
              </button>
            </div>

            {showCreateForm ? (
              <div className="px-4 pt-3">
                <CreateListForm
                  pending={createList.isPending}
                  error={createList.isError ? GENERIC_CREATE_ERROR : null}
                  onSubmit={(values) =>
                    createList.mutate(values.title, {
                      onSuccess: (created) => selectAndClose(created.id),
                    })
                  }
                  onCancel={() => setShowCreateForm(false)}
                />
              </div>
            ) : null}

            {selectedList ? (
              <div className="mt-2 border-t border-gray-100 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void navigate(`/lists/${selectedList.id}/categories`, {
                      state: { role: selectedList.role } satisfies CategoriesNavigationState,
                    });
                  }}
                  className={rowBaseClass}
                >
                  Categories
                </button>
                {selectedList.role === "OWNER" ? (
                  <>
                    {/* Rename (docs/TASKS.md → T40): OWNER-only, PATCH /lists/:id.
                        The menu stays open on success so the renamed switcher row
                        (and the header behind the overlay) show instantly. */}
                    <button
                      type="button"
                      onClick={() => setShowRenameForm((visible) => !visible)}
                      className={rowBaseClass}
                    >
                      Rename
                    </button>
                    {showRenameForm ? (
                      <div className="px-4 pt-3">
                        <RenameListForm
                          key={selectedList.id}
                          currentTitle={selectedList.title}
                          pending={renameList.isPending}
                          error={renameList.isError ? GENERIC_RENAME_ERROR : null}
                          onSubmit={(values) =>
                            renameList.mutate(
                              { id: selectedList.id, title: values.title },
                              { onSuccess: () => setShowRenameForm(false) },
                            )
                          }
                          onCancel={() => setShowRenameForm(false)}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        void navigate(`/lists/${selectedList.id}/members`, {
                          state: { role: selectedList.role } satisfies MembersNavigationState,
                        });
                      }}
                      className={rowBaseClass}
                    >
                      Members
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <DeleteListButton
                        key={selectedList.id}
                        pending={deleteList.isPending}
                        onConfirm={() => deleteList.mutate(selectedList.id, { onSuccess: close })}
                      />
                    </div>
                    {deleteList.isError ? (
                      <p role="alert" className="px-4 pb-2 text-sm text-red-600">
                        {GENERIC_DELETE_ERROR}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </section>

          {user?.role === "admin" ? (
            <section aria-label="Admin tools" className="py-3">
              <h2 className={blockHeadingClass}>Admin</h2>
              <button
                type="button"
                onClick={() => {
                  close();
                  void navigate("/users");
                }}
                className={rowBaseClass}
              >
                Users management
              </button>
            </section>
          ) : null}
        </MenuOverlay>
      ) : null}
    </>
  );
}

interface MenuOverlayProps {
  onClose: () => void;
  children: ReactNode;
}

/** Backdrop + right-hand drawer. Closes on backdrop tap and Escape. */
function MenuOverlay({ onClose, children }: MenuOverlayProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" data-testid="menu-overlay">
      <button
        type="button"
        aria-label="Close menu"
        data-testid="menu-backdrop"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        // biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings UA styles (max-width, inset) that fight the drawer layout
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        data-testid="menu-panel"
        className="absolute inset-y-0 right-0 flex w-[85%] max-w-sm flex-col overflow-y-auto bg-white shadow-xl focus:outline-none"
      >
        {children}
      </div>
    </div>
  );
}
