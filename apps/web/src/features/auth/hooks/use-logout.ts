import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { clearNonSessionCaches, setSessionCache } from "./use-session";

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSettled: () => {
      setSessionCache(queryClient, null);
      clearNonSessionCaches(queryClient);
    },
  });
}
