import type { AddListMemberRequest, ListRole } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { membersApi } from "../api/members-api";
import { listDetailQueryKey } from "./use-list-detail";

/**
 * Member mutations (docs/API.md → Lists — members; OWNER-only, enforced
 * server-side). Every success refetches the list detail, so the members
 * payload always reflects the change (docs/TASKS.md → T20 Definition of Done).
 */
export function useAddMember(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddListMemberRequest) => membersApi.add(listId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listDetailQueryKey(listId) });
    },
  });
}

export function useUpdateMemberRole(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ListRole }) =>
      membersApi.updateRole(listId, userId, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listDetailQueryKey(listId) });
    },
  });
}

export function useRemoveMember(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => membersApi.remove(listId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listDetailQueryKey(listId) });
    },
  });
}
