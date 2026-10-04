import type { ListRole } from "@grocery/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../auth/hooks/use-session";
import { LISTS_QUERY_KEY, useLists } from "../../lists/hooks/use-lists";
import { AddMemberForm } from "../components/add-member-form";
import { MemberListContainer } from "../components/member-list-container";
import { useListDetail } from "../hooks/use-list-detail";
import { useRemoveMember } from "../hooks/use-member-mutations";

/** The role the main screen's "Members" button carries into this page. */
export interface MembersNavigationState {
  role?: ListRole;
}

/**
 * Permissions UI (docs/TASKS.md → T20, read-only + leave for members in T88):
 * OWNERs manage members (add/role/remove); EDITOR/VIEWER members see the
 * read-only roster — the owner's email badged Owner — plus a Leave action.
 * The role rides on the navigation state of the "Members" button; deep links
 * resolve it from the lists cache. Non-members get a notice and the member
 * data is never fetched for them.
 */
export function MembersPage() {
  const { listId = "" } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const lists = useLists();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const leave = useRemoveMember(listId);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const stateRole = (location.state as MembersNavigationState | null)?.role ?? null;
  const role = stateRole ?? lists.data?.find((list) => list.id === listId)?.role ?? null;
  const isOwner = role === "OWNER";
  const detail = useListDetail(role ? listId : null);

  const listTitle =
    lists.data?.find((list) => list.id === listId)?.title ?? detail.data?.title ?? null;

  function handleLeaveConfirm() {
    if (!user) return;
    leave.mutate(user.id, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
        void navigate("/");
      },
    });
  }

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
            <h1 className="text-lg font-semibold text-gray-900">Members</h1>
            {listTitle ? <p className="truncate text-sm text-gray-500">{listTitle}</p> : null}
          </div>
        </header>

        {isOwner ? (
          detail.status === "pending" ? (
            <output className="block text-sm text-gray-500">Loading members…</output>
          ) : detail.status === "error" ? (
            <p role="alert" className="text-sm text-red-600">
              Could not load the members.
            </p>
          ) : (
            <>
              <AddMemberForm listId={listId} />
              <MemberListContainer listId={listId} detail={detail.data} />
            </>
          )
        ) : role === null ? (
          lists.isError ? (
            <p role="alert" className="text-sm text-gray-500">
              Could not load your lists.
            </p>
          ) : lists.isSuccess ? (
            <p className="text-sm text-gray-500">List not found among your lists.</p>
          ) : (
            <output className="block text-sm text-gray-500">Loading…</output>
          )
        ) : detail.status === "pending" ? (
          <output className="block text-sm text-gray-500">Loading members…</output>
        ) : detail.status === "error" ? (
          <p role="alert" className="text-sm text-red-600">
            Could not load the members.
          </p>
        ) : (
          <>
            <ul aria-label="Members" className="space-y-2">
              {detail.data.members.map((member) => {
                const isListOwner = member.userId === detail.data.owner.id;
                return (
                  <li
                    key={member.userId}
                    data-testid={`member-row-${member.userId}`}
                    className="flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm ring-1 ring-gray-200"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {member.email}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {isListOwner
                          ? "List owner"
                          : member.role === "EDITOR"
                            ? "Editor"
                            : "Viewer"}
                      </span>
                    </span>
                    {isListOwner ? (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        Owner
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {leave.isError ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                Could not leave the list. Please try again.
              </p>
            ) : null}
            {confirmingLeave ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={leave.isPending}
                  onClick={handleLeaveConfirm}
                  aria-label={`Confirm leave ${detail.data.title}`}
                  className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {leave.isPending ? "Leaving…" : "Confirm leave"}
                </button>
                <button
                  type="button"
                  disabled={leave.isPending}
                  onClick={() => setConfirmingLeave(false)}
                  className="min-h-11 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingLeave(true)}
                aria-label={`Leave ${detail.data.title}`}
                className="min-h-11 w-full rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Leave list
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
