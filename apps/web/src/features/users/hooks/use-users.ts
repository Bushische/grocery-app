import { useQuery } from "@tanstack/react-query";
import { usersApi } from "../api/users-api";

/** Query key for the admin user list (docs/CONVENTIONS.md → Frontend). */
export const USERS_QUERY_KEY = ["users"] as const;

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: ({ signal }) => usersApi.list(signal),
    // The admin gate lives on the page — never fetch for a non-admin (T32 DoD).
    enabled,
  });
}
