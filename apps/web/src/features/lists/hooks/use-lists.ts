import { useQuery } from "@tanstack/react-query";
import { listsApi } from "../api/lists-api";

/** Query key per docs/CONVENTIONS.md → Frontend. */
export const LISTS_QUERY_KEY = ["lists"] as const;

export function useLists() {
  return useQuery({
    queryKey: LISTS_QUERY_KEY,
    queryFn: ({ signal }) => listsApi.list(signal),
  });
}
