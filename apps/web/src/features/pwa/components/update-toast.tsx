import { useRegisterSW } from "virtual:pwa-register/react";
import { useState } from "react";

/**
 * "New version available" refresh toast (T47).
 *
 * With `registerType: "prompt"` the freshly deployed service worker waits in
 * the `waiting` state instead of silently taking over: `useRegisterSW` flips
 * `needRefresh` when it is installed, and tapping Refresh calls
 * `updateServiceWorker(true)` (skipWaiting + reload) so the new shell takes
 * over immediately — no double reload. Dismissing hides the toast until the
 * next version (fresh mount, fresh `needRefresh` cycle).
 *
 * Positioned above the fixed bottom input bar (`bottom-24` clears its ~70 px
 * height); both buttons meet the > 40 px touch-target rule (`min-h-11`).
 * Renders nothing in dev (no SW registered there) and when up to date.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || dismissed) return null;

  return (
    <output
      data-testid="update-toast"
      className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
    >
      <div className="flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 py-2 pl-4 pr-2 text-sm text-white shadow-lg">
        <span>New version available</span>
        <button
          type="button"
          data-testid="update-toast-refresh"
          onClick={() => void updateServiceWorker(true)}
          className="min-h-11 shrink-0 rounded-lg bg-green-600 px-4 text-sm font-semibold text-white hover:bg-green-500"
        >
          Refresh
        </button>
        <button
          type="button"
          data-testid="update-toast-dismiss"
          aria-label="Dismiss update"
          onClick={() => setDismissed(true)}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </output>
  );
}
