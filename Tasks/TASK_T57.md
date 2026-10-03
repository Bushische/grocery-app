# T57 — Live list refresh (see other devices' adds without touching the app)
- **Goal:** Items added/moved on another device appear on an idle screen within seconds.
- **Inputs:** `useItems` (`apps/web/src/features/lists/hooks/use-items.ts`), `useLists` (`use-lists.ts`); TanStack Query polling (auto-paused while the tab is hidden).
- **Outputs:** `LIVE_REFRESH_INTERVAL_MS = 15_000` shared constant; `refetchInterval` + `refetchOnWindowFocus` on the items and lists queries (tabs + to-buy/bought counts track too).
- **Definition of Done:** fake-timer pin (`use-items.test.tsx`: initial fetch + refetch after one interval); no new network load while hidden (TanStack default); `pnpm test && pnpm lint` green.
- **Dependencies:** none (web-only, no API changes).
