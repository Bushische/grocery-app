import type { ListDetail, ListMember, ListRole } from "@grocery/shared";

export interface MemberListProps {
  detail: ListDetail;
  updatePending: boolean;
  updateError: string | null;
  removePending: boolean;
  removeError: string | null;
  onChangeRole: (userId: string, role: ListRole) => void;
  onRemove: (userId: string) => void;
}

const selectClassName =
  "h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 " +
  "focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";

/**
 * Role options for a member row. OWNER is only offered when the row already
 * carries it (an API-level possibility): the UI itself never creates a second
 * OWNER — docs/PROJECT.md models one owner per list, and the creator's row is
 * immutable (server 409s any role change/removal of the list owner).
 */
function roleOptions(member: ListMember): ListRole[] {
  return member.role === "OWNER" ? ["OWNER", "EDITOR", "VIEWER"] : ["EDITOR", "VIEWER"];
}

const ROLE_LABELS: Record<ListRole, string> = {
  OWNER: "Owner",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

/**
 * The member list (docs/TASKS.md → T20): every member's email + role, editable
 * (role select, remove) except the list owner, whose row is read-only.
 */
export function MemberList({
  detail,
  updatePending,
  updateError,
  removePending,
  removeError,
  onChangeRole,
  onRemove,
}: MemberListProps) {
  const members = detail.members;
  return (
    <div className="space-y-2">
      {updateError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {updateError}
        </p>
      ) : null}
      {removeError ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {removeError}
        </p>
      ) : null}
      <ul aria-label="Members" className="space-y-2">
        {members.map((member) => {
          const isListOwner = member.userId === detail.owner.id;
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
                  {isListOwner ? "List owner" : ROLE_LABELS[member.role]}
                </span>
              </span>
              {isListOwner ? (
                <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                  Owner
                </span>
              ) : (
                <>
                  <select
                    aria-label={`Role for ${member.email}`}
                    value={member.role}
                    disabled={updatePending}
                    onChange={(event) =>
                      onChangeRole(member.userId, event.target.value as ListRole)
                    }
                    className={selectClassName}
                  >
                    {roleOptions(member).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(member.userId)}
                    disabled={removePending}
                    aria-label={`Remove ${member.email}`}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {members.length === 1 && members[0]?.userId === detail.owner.id ? (
        <p className="text-sm text-gray-500">No members yet — add one by email above.</p>
      ) : null}
    </div>
  );
}
