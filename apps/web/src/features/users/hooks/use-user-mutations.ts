import type { CreateUserRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "../api/users-api";
import { USERS_QUERY_KEY } from "./use-users";

/** User mutations (docs/API.md → Users; admin-only, enforced server-side). */
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateUserRequest) => usersApi.create(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => usersApi.remove(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}
