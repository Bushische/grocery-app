import type { ListDetail, ListSummary } from "@grocery/shared";
import { updateListRequestSchema } from "@grocery/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listDetailQueryKey } from "../../members/hooks/use-list-detail";
import { listsApi } from "../api/lists-api";
import { LIVE_REFRESH_INTERVAL_MS, itemsQueryKey } from "./use-items";

/** Query key per docs/CONVENTIONS.md → Frontend. */
export const LISTS_QUERY_KEY = ["lists"] as const;

export function useLists() {
  return useQuery({
    queryKey: LISTS_QUERY_KEY,
    queryFn: ({ signal }) => listsApi.list(signal),
    // Same live refresh as useItems: tabs + to-buy/bought counts track other devices.
    refetchInterval: LIVE_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => listsApi.create(title),
    onSuccess: (created) => {
      // T41: selection is URL-owned — the menu navigates to /lists/:id right
      // after the create, so the summary must be in the cache before the
      // invalidation refetch lands (otherwise the page would redirect away).
      const lists = queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY);
      if (lists && !lists.some((list) => list.id === created.id)) {
        queryClient.setQueryData(LISTS_QUERY_KEY, [...lists, created]);
      }
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

/** Renames one cached `["lists"]` summary row (pure helper). */
export function renameListInSummaries(
  lists: ListSummary[],
  id: string,
  title: string,
): ListSummary[] {
  return lists.map((list) => (list.id === id ? { ...list, title } : list));
}

/** Renames the cached `["list", id]` detail (pure helper). */
export function renameListInDetail(detail: ListDetail, title: string): ListDetail {
  return { ...detail, title };
}

/**
 * PATCH /lists/:id (docs/TASKS.md → T40) with optimistic title updates on
 * `["lists"]` (header line + menu switcher row) and `["list", id]` (members
 * page detail), rolled back on failure. The PATCH response carries the fresh
 * summary, so caches are reconciled from it — no refetch at all.
 */
export function useUpdateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => listsApi.update(id, title),
    onMutate: async ({ id, title }) => {
      // Validate/trim at the boundary via the shared schema so the optimistic
      // cache shows exactly what the server will store (identical rules to
      // create; listsApi.update re-parses for the PATCH body).
      const { title: clean } = updateListRequestSchema.parse({ title });
      const detailKey = listDetailQueryKey(id);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: LISTS_QUERY_KEY }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);
      const previousLists = queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY);
      const previousDetail = queryClient.getQueryData<ListDetail>(detailKey);
      if (previousLists) {
        queryClient.setQueryData(LISTS_QUERY_KEY, renameListInSummaries(previousLists, id, clean));
      }
      if (previousDetail) {
        queryClient.setQueryData(detailKey, renameListInDetail(previousDetail, clean));
      }
      return { previousLists, previousDetail };
    },
    onSuccess: (summary, { id }) => {
      // Reconcile with the server's authoritative row — no refetch needed.
      const lists = queryClient.getQueryData<ListSummary[]>(LISTS_QUERY_KEY);
      if (lists) {
        queryClient.setQueryData(
          LISTS_QUERY_KEY,
          lists.map((list) => (list.id === id ? summary : list)),
        );
      }
      const detail = queryClient.getQueryData<ListDetail>(listDetailQueryKey(id));
      if (detail) {
        queryClient.setQueryData(listDetailQueryKey(id), renameListInDetail(detail, summary.title));
      }
    },
    onError: (_error, { id }, context) => {
      if (context?.previousLists) {
        queryClient.setQueryData(LISTS_QUERY_KEY, context.previousLists);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(listDetailQueryKey(id), context.previousDetail);
      }
    },
  });
}
