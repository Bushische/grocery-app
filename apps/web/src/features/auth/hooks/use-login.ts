import type { LoginRequest } from "@grocery/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { setSessionCache } from "./use-session";

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.login(input.email, input.password),
    onSuccess: (user) => setSessionCache(queryClient, user),
  });
}
