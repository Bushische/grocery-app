import { useState } from "react";

/**
 * Test double for `virtual:pwa-register/react` (T47).
 *
 * The real module is provided by vite-plugin-pwa at build time and is only
 * resolvable through the web vite config — the root vitest run has no such
 * config, so `vitest.config.ts` aliases the specifier here. The stub mirrors
 * the real hook's shape with the idle state (no update pending, dev-like);
 * `update-toast.test.tsx` overrides it per-test via `vi.mock`.
 */
export function useRegisterSW() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  return {
    needRefresh: [needRefresh, setNeedRefresh] as const,
    offlineReady: [offlineReady, setOfflineReady] as const,
    updateServiceWorker: async (_reloadPage?: boolean): Promise<void> => {},
  };
}
