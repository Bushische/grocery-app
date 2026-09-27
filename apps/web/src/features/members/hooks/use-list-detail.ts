import { useQuery } from "@tanstack/react-query";
import { membersApi } from "../api/members-api";

/** List-detail query key per docs/CONVENTIONS.md → Frontend (`["list", id]`). */
export const listDetailQueryKey = (listId: string) => ["list", listId] as const;

/**
 * GET /lists/:id — title, owner, and members. Enabled only with a known list:
 * the members page resolves the caller's role first and fetches for OWNERs.
 */
export function useListDetail(listId: string | null) {
  return useQuery({
    queryKey: listDetailQueryKey(listId ?? ""),
    queryFn: ({ signal }) => {
      if (listId === null) throw new Error("useListDetail requires a listId");
      return membersApi.detail(listId, signal);
    },
    enabled: listId !== null,
  });
}
