# T47 — "New version available" refresh toast
- **Goal:** Every deploy confuses users: the SW precache serves the old shell until a second
  reload. Replace silent autoUpdate with an explicit one-tap update flow.
- **Inputs:** T24.5 (PWA config, generateSW + autoUpdate), docs/PROJECT.md (Mobile & UX).
- **Outputs:** switch `vite-plugin-pwa` to `registerType: "prompt"`; a small non-blocking toast
  ("New version available — Refresh") appears when a new worker is installed (`useRegisterSW`
  onNeedRefresh → `updateServiceWorker(true)`); toast is ≥ 40 px tap target, dismissible, and
  does not overlap the bottom input bar; dev mode unchanged (no SW).
- **Definition of Done:** after deploying a new bundle the next visit shows the toast; tapping
  Reload swaps to the new shell immediately (no double reload); dismiss hides it until the next
  version; tests pin the toast wiring (onNeedRefresh → render, tap → updateServiceWorker).
- **Dependencies:** T24.5, T14.
