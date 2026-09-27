import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listsApi } from "../api/lists-api";
import { itemsQueryKey } from "./use-items";

/** Query key per docs/CONVENTIONS.md → Frontend. */
export const LISTS_QUERY_KEY = ["lists"] as const;

export function useLists() {
  return useQuery({
    queryKey: LISTS_QUERY_KEY,
    queryFn: ({ signal }) => listsApi.list(signal),
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => listsApi.create(title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
    },
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => listsApi.remove(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: LISTS_QUERY_KEY });
      queryClient.removeQueries({ queryKey: itemsQueryKey(id) });
    },
  });
}
