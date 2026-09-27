import type { ListDetail, ListRole } from "@grocery/shared";
import { useRemoveMember, useUpdateMemberRole } from "../hooks/use-member-mutations";
import { MemberList } from "./member-list";

export interface MemberListContainerProps {
  listId: string;
  detail: ListDetail;
}

/**
 * Wires the member list to the role-change/remove mutations (docs/TASKS.md →
 * T20). No optimistic updates: the members list is small and every success
 * refetches the detail, so the members payload reflects each change.
 */
export function MemberListContainer({ listId, detail }: MemberListContainerProps) {
  const updateRole = useUpdateMemberRole(listId);
  const remove = useRemoveMember(listId);

  return (
    <MemberList
      detail={detail}
      updatePending={updateRole.isPending}
      updateError={updateRole.isError ? "Could not update the role. Please try again." : null}
      removePending={remove.isPending}
      removeError={remove.isError ? "Could not remove the member. Please try again." : null}
      onChangeRole={(userId: string, role: ListRole) => updateRole.mutate({ userId, role })}
      onRemove={(userId: string) => remove.mutate(userId)}
    />
  );
}
