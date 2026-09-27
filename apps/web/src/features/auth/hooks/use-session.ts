import type { AuthUser } from "@grocery/shared";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

/** Session cache entry — resolved once per app load via a silent refresh. */
export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export type SessionStatus = "pending" | "authenticated" | "anonymous";

export interface Session {
  status: SessionStatus;
  user: AuthUser | null;
}

export function setSessionCache(queryClient: QueryClient, user: AuthUser | null): void {
  queryClient.setQueryData<AuthUser | null>(SESSION_QUERY_KEY, user);
}

/** Drops every cache except the session (used on logout). */
export function clearNonSessionCaches(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] });
}

/**
 * Boots the session: one silent `POST /auth/refresh` on app open (the refresh
 * cookie rides along via the same-origin proxy). Pending → "pending" (splash),
 * cookie valid → "authenticated", otherwise → "anonymous" (login page).
 */
export function useSession(): Session {
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => api.refreshSession(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return {
    status: query.isPending ? "pending" : query.data ? "authenticated" : "anonymous",
    user: query.data ?? null,
  };
}
