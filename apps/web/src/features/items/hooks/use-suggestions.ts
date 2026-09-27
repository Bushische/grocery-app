import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { itemsApi } from "../api/items-api";

/** Debounce for the suggestion query (docs/TASKS.md → T17: 200 ms). */
export const SUGGEST_DEBOUNCE_MS = 200;

/** Suggestion query key per docs/CONVENTIONS.md → Frontend. */
export const suggestQueryKey = (listId: string, query: string) =>
  ["suggest", listId, query] as const;

/** Returns `value` after it has been stable for `delayMs`; resets on every change. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Debounced (200 ms) grouped suggestions for one list (GET /items/suggest).
 * Disabled while the trimmed query is blank, so an untouched input box never
 * fetches; results are capped server-side (docs/API.md → Suggest & Search).
 */
export function useSuggest(listId: string, query: string) {
  const debouncedQuery = useDebouncedValue(query.trim(), SUGGEST_DEBOUNCE_MS);
  return useQuery({
    queryKey: suggestQueryKey(listId, debouncedQuery),
    queryFn: ({ signal }) => itemsApi.suggest(listId, debouncedQuery, signal),
    enabled: debouncedQuery.length > 0,
  });
}
