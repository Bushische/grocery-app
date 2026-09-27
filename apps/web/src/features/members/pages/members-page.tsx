import type { ListRole } from "@grocery/shared";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useLists } from "../../lists/hooks/use-lists";
import { AddMemberForm } from "../components/add-member-form";
import { MemberListContainer } from "../components/member-list-container";
import { useListDetail } from "../hooks/use-list-detail";

/** The role the main screen's "Members" button carries into this page. */
export interface MembersNavigationState {
  role?: ListRole;
}

/**
 * Permissions UI (docs/TASKS.md → T20): manage a list's members — visible to
 * the OWNER only. The role rides on the navigation state of the "Members"
 * button; deep links resolve it from the lists cache. EDITOR/VIEWER (and
 * non-members) get a notice instead of the editor, and the member data is
 * never even fetched for them.
 */
export function MembersPage() {
  const { listId = "" } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const lists = useLists();

  const stateRole = (location.state as MembersNavigationState | null)?.role ?? null;
  const role = stateRole ?? lists.data?.find((list) => list.id === listId)?.role ?? null;
  const isOwner = role === "OWNER";
  const detail = useListDetail(isOwner ? listId : null);

  const listTitle =
    lists.data?.find((list) => list.id === listId)?.title ?? detail.data?.title ?? null;

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
            <p role="alert" className="text-sm text-red-600">
              Could not load your lists.
            </p>
          ) : lists.isSuccess ? (
            <p className="text-sm text-gray-500">List not found among your lists.</p>
          ) : (
            <output className="block text-sm text-gray-500">Loading…</output>
          )
        ) : (
          <p className="text-sm text-gray-500">Only the list owner can manage members.</p>
        )}
      </div>
    </main>
  );
}
