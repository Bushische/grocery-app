# Tasks

26 vertical tasks. Each is self-sufficient: implementable, testable, and mergeable on its own.
Stack and contracts are defined in `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
`docs/API.md`, `docs/CONVENTIONS.md`.

> **Execution rule for the AI agent:** one task per fresh agent session, driven by
> `docs/EXECUTION_PROMPT.md` + `docs/EXECUTION_LOG.md` (automated via `scripts/run-next-task.sh`).
> Each task results in exactly one commit on `main`, made by the orchestrator **after**
> `pnpm test && pnpm lint` pass. The agent must **never** modify another task's contract without
> updating `packages/shared` in the same task.

---

## Phase A — Foundations

### T1 — Repository scaffolding
- **Goal:** Monorepo skeleton ready for all later tasks.
- **Inputs:** docs/ARCHITECTURE.md (Repos, Dev tooling), docs/CONVENTIONS.md.
- **Outputs:** pnpm workspace config; `apps/web`, `apps/api`, `packages/shared` (empty stubs);
  `docker-compose.yml` placeholder; `.editorconfig`; `biome.json`; `tsconfig.base.json`;
  `.env.example`; `.gitignore`; README skeleton; root scripts (`dev`, `test`, `lint`).
- **Definition of Done:** `pnpm install` succeeds; `pnpm lint` passes on stubs; CI-agnostic.
- **Dependencies:** none.

### T2 — Docker Compose + dev tooling
- **Goal:** One-command dev environment (no db container — SQLite is in-process).
- **Inputs:** docs/ARCHITECTURE.md (Containers, Networking, Persistence).
- **Outputs:** `docker-compose.yml` with services `api` (node:20-alpine, dev mount, tsx watch),
  `web` (Vite dev server + proxy `/api` & `/static` → api), `tunnel` (placeholder); volumes
  `data` (`/data`) and `uploads`; healthchecks; `.env` flow documented.
- **Definition of Done:** `docker compose up` boots api + web with no errors; volumes created;
  data survives a container restart.
- **Dependencies:** T1.

### T3 — Drizzle schema + initial migration + seed
- **Goal:** All tables from docs/DATA_MODEL.md created and reproducible.
- **Inputs:** docs/DATA_MODEL.md, docs/PROJECT.md (Auth, Lists).
- **Outputs:** `apps/api/src/db/schema.ts` (verbatim from DATA_MODEL), `drizzle.config.ts`,
  `apps/api/src/db/client.ts` (pragmas), migrations dir, `scripts/seed.ts`.
- **Definition of Done:** fresh DB → `db:migrate` applies cleanly; `db:seed` creates 1 admin user,
  1 member user, 1 list, 3 categories (incl. "Other"), 3 items, 4 price observations; re-running
  seed is idempotent; FK violations are rejected.
- **Dependencies:** T1.

### T4 — Fastify bootstrap *(modified: cookie plugin + credentialed CORS)*
- **Goal:** API server shell with plugins and shared infrastructure.
- **Inputs:** docs/CONVENTIONS.md (Backend), docs/API.md (Conventions, Health).
- **Outputs:** plugins `@fastify/cors` (credentials: true), `@fastify/cookie`, `@fastify/multipart`,
  `@fastify/static`, `@fastify/jwt`, `@fastify/helmet`; centralized error handler
  (`FastifyHttpError` → `{ error: { code, message } }`); pino logging; `GET /health`.
- **Definition of Done:** `GET /health` returns 200 `{"status":"ok"}`; unknown route returns the
  standard error shape; server boots < 2 s with < 60 MB RSS.
- **Dependencies:** T1, T3.

### T4.5 — Static cache headers *(new: post-T4 fix — `/static` was registered without caching)*
- **Goal:** Item images are cached on the user's device; no repeat downloads.
- **Inputs:** docs/ARCHITECTURE.md (Persistence), T10 (content-addressed filenames).
- **Outputs:** `@fastify/static` registration in `apps/api/src/app.ts` gets `setHeaders` →
  `Cache-Control: public, max-age=31536000, immutable` on `/static/*` responses; default ETag
  stays enabled as fallback. Safe to cache forever because T10 uses content-addressed URLs
  (`<id>-<hash>.webp`) — a re-upload changes the URL instead of the bytes at an old one.
- **Definition of Done:** test: `GET /static/<file>` → 200 with the immutable cache header; all
  existing api tests stay green; steady RSS still < 60 MB.
- **Dependencies:** T4.

### T5 — Auth module *(modified: refresh rotation, hashes in SQLite)*
- **Goal:** Login once; silent refresh works on mobile browsers.
- **Inputs:** docs/PROJECT.md (Auth), docs/API.md (Auth), docs/DATA_MODEL.md (refreshTokens).
- **Outputs:** `POST /auth/login`, `POST /auth/refresh` (rotates token), `POST /auth/logout`,
  `GET /me`; bcrypt hashing; access JWT 15 min; refresh token 30 d as HttpOnly/Secure/
  SameSite=Strict cookie (Path=/api/auth), sha256 hash stored in `refresh_tokens`;
  `requireAuth` middleware.
- **Definition of Done:** integration tests: login → me; refresh returns new access token AND
  rotates the cookie (old refresh rejected); logout revokes; wrong password → 401.
- **Dependencies:** T4.

## Phase B — Core domain

### T6 — Lists CRUD + members/permissions
- **Goal:** Multi-user lists with roles.
- **Inputs:** docs/API.md (Lists, Permissions), docs/DATA_MODEL.md.
- **Outputs:** list endpoints incl. members management; `requireListRole('EDITOR'|'OWNER')`
  middleware; creating a list auto-creates the "Other" default category.
- **Definition of Done:** tests for role matrix (VIEWER read-only, EDITOR mutate, OWNER manage);
  unauthorized access → 403.
- **Dependencies:** T5.

### T7 — Categories CRUD
- **Goal:** Per-list categories with colors.
- **Inputs:** docs/API.md (Categories), docs/PROJECT.md (Categories).
- **Outputs:** category endpoints; hex color validation; `sortOrder` support; delete protected
  by FK restrict → 409 when items assigned.
- **Definition of Done:** tests: create/edit/list with itemCount; delete empty category → 204;
  delete non-empty → 409.
- **Dependencies:** T6.

### T8 — Items CRUD + smart-add *(modified: fuzzy via LIKE + TS scoring, no pg_trgm)*
- **Goal:** Item lifecycle start; the key endpoint for UI input box and AI agents.
- **Inputs:** docs/API.md (Items — smart-add algorithm), docs/DATA_MODEL.md.
- **Outputs:** `GET /lists/:id/items?status=`, `POST /lists/:id/items`, `POST
  /lists/:id/items/smart-add`, `GET /items/:id`, `PATCH /items/:id`, `DELETE /items/:id`;
  smart-add implements exact → substring (LIKE) → fuzzy (Dice ≥ 0.6, pure TS) → create in
  "Other"; matching a BOUGHT item re-activates it (addedAt=now, boughtAt=null, usageCount+1).
- **Definition of Done:** tests per algorithm step incl. re-activation and `matchedBy` values;
  items ordered by sortOrder then addedAt; `daysInList` computed.
- **Dependencies:** T7.

### T9 — Move items TO_BUY ↔ BOUGHT
- **Goal:** Toggle status with correct timestamps/order.
- **Inputs:** docs/API.md (Items — move).
- **Outputs:** `POST /items/:id/move`; sets `boughtAt` / resets `addedAt`, bumps `usageCount`,
  appends to end of target section's `sortOrder`.
- **Definition of Done:** tests: move both directions; counters update; order appended.
- **Dependencies:** T8.

### T10 — Image upload
- **Goal:** Item reference images, lightweight.
- **Inputs:** docs/API.md (Items — image), docs/ARCHITECTURE.md (Persistence).
- **Outputs:** `POST /items/:id/image` (multipart, < 2 MB); `sharp` → 600 px webp at
  `/data/images/<id>-<contenthash>.webp` (hash of output bytes — content-addressed, so a
  re-upload yields a new URL and long-lived device caching per T4.5 is safe); served via
  `@fastify/static` at `/static` (cache headers set by T4.5).
- **Definition of Done:** test: upload → file exists, dimensions ≤ 600 px, served over `/static`;
  re-upload changes the URL; oversize file → 400.
- **Dependencies:** T8.

### T11 — Price observations + history
- **Goal:** Price history as the single source of truth (current price = latest observation).
- **Inputs:** docs/API.md (Prices), docs/DATA_MODEL.md (priceObservations).
- **Outputs:** `POST /items/:id/prices` (price > 0, shop non-empty; optional `observedAt`),
  `GET /items/:id/prices` with cursor pagination; `currentPrice` included in item reads.
- **Definition of Done:** tests: add observation appears first in history; validation errors;
  cursor pagination works.
- **Dependencies:** T8.

### T12 — Suggest + search endpoints
- **Goal:** Power the bottom input box; give agents a search API.
- **Inputs:** docs/API.md (Suggest & Search), docs/PROJECT.md (UX).
- **Outputs:** `GET /items/suggest?q=&listId=` (LIKE prefilter + Dice score, grouped by category,
  usageCount DESC, max 20); `GET /search?q=&listId=?` across the user's lists.
- **Definition of Done:** tests: grouping/colors correct; empty query → 400; fuzzy ordering by
  usageCount.
- **Dependencies:** T8.

### T13 — AI agent API tokens
- **Goal:** Let AI agents call the REST API without OAuth.
- **Inputs:** docs/API.md (API tokens), docs/PROJECT.md (Auth).
- **Outputs:** `GET/POST/DELETE /api-tokens`; token format `glc_<random>`, sha256 hash stored,
  plaintext returned once; auth middleware accepts JWT **or** `Bearer glc_…`; `lastUsedAt`
  updated on use.
- **Definition of Done:** tests: created token authorizes item endpoints as its owner; revoked
  token → 401; hash (never plaintext) is stored.
- **Dependencies:** T5.

## Phase C — Frontend

### T14 — Web app scaffold, auth flow, login page
- **Goal:** React shell with silent auth.
- **Inputs:** docs/PROJECT.md (Auth, Mobile & UX Constraints), docs/CONVENTIONS.md (Frontend).
- **Outputs:** Vite + React + TS + Tailwind + HeadlessUI; router; Zustand auth store (access
  token in memory); api client with single-flight refresh-on-401; TanStack Query setup; login
  page; feature folder structure.
- **Definition of Done:** login → lists load; page reload keeps the session (silent refresh);
  logout works.
- **Dependencies:** T5.

### T15 — Lists view
- **Goal:** Select / create / delete lists.
- **Inputs:** docs/API.md (Lists).
- **Outputs:** tabs/selector for lists; create + delete actions (permissions-aware).
- **Definition of Done:** switching lists refetches items; OWNER sees delete, others don't.
- **Dependencies:** T14, T6.

### T16 — Main screen: mobile UI **+ drag-and-drop reordering** *(modified)*
- **Goal:** The "Buy Me a Pie" screen with manual ordering.
- **Inputs:** docs/PROJECT.md (UX, Mobile & UX Constraints), docs/API.md (Items, Reorder).
- **Outputs:** TO_BUY section (top) / BOUGHT section (bottom); row = color bar + title + qty +
  "3d" badge + ≡ handle (TO_BUY only); move buttons (buy/unbuy); long-press (500 ms) / right-click
  → navigate to details; `@dnd-kit/core` + `@dnd-kit/sortable` with TouchSensor (150 ms delay,
  5 px tolerance), drag only via handle, optimistic reorder + `POST /lists/:id/items/reorder`;
  touch targets > 40 px.
- **Definition of Done:** on a real phone browser: reorder by handle works, long-press opens
  details, no conflict between scroll/drag/long-press; order persists after reload.
- **Dependencies:** T14, T8, T9, T16.5.

### T16.5 — Reorder API endpoint *(new)*
- **Goal:** Persist manual ordering.
- **Inputs:** docs/API.md (reorder), docs/DATA_MODEL.md (sortOrder).
- **Outputs:** `POST /lists/:id/items/reorder`; validates all ids belong to list+status; assigns
  `sortOrder = index` in one transaction.
- **Definition of Done:** tests: valid reorder → 204 and persisted order; foreign id → 400;
  50 items reorder < 10 ms.
- **Dependencies:** T8.

### T17 — Bottom input box with grouped suggestions
- **Goal:** Fast add with autocomplete.
- **Inputs:** docs/API.md (Suggest, smart-add), docs/PROJECT.md (UX).
- **Outputs:** input box pinned to bottom; debounced (200 ms) suggestions grouped by category
  with color bars; Enter / tap → `smart-add`; virtualize only if > 200 results.
- **Definition of Done:** typing "mi" shows grouped matches; selecting a bought item re-activates
  it; unknown text creates an item in "Other".
- **Dependencies:** T16, T12.

### T18 — Item details page
- **Goal:** Edit everything about an item; see price history.
- **Inputs:** docs/PROJECT.md (Item Detail View), docs/API.md (Items, Prices).
- **Outputs:** details view (long-press target): title, category select, qty, image upload +
  preview, price+shop form → `POST /items/:id/prices`, price history line chart via `uplot`
  (X: date, Y: price, point labels price+shop). Image upload downscales client-side before POST
  (`createImageBitmap` + canvas: max 1200 px long edge, WebP q≈0.8) so phone photos (~12 MB)
  become < ~500 KB on the wire; server-side `sharp` (T10) is the safety net, not the only resize.
- **Definition of Done:** saving price adds a point to the chart; image round-trips.
- **Dependencies:** T16, T10, T11.

### T19 — Category management page
- **Goal:** Edit categories; see their items.
- **Inputs:** docs/PROJECT.md (Categories), docs/API.md (Categories).
- **Outputs:** category list (color swatch, title), edit color/title, item counts, link to
  filtered item view, delete (disabled when 409-able), reorder categories.
- **Definition of Done:** color change reflects instantly in main screen color bars.
- **Dependencies:** T16, T7.

### T20 — Permissions UI
- **Goal:** Manage list members.
- **Inputs:** docs/API.md (Lists — members), docs/PROJECT.md (Lists).
- **Outputs:** members editor (add by email, change role, remove) visible to OWNER only.
- **Definition of Done:** EDITOR/VIEWER cannot open it; changes reflect in list members payload.
- **Dependencies:** T15, T6.

## Phase D — Deployment & Access

### T21 — Production Dockerfiles + local build/deploy scripts *(modified: no CI/CD)*
- **Goal:** Reproducible arm64 images built on the laptop.
- **Inputs:** docs/ARCHITECTURE.md (Build & deploy).
- **Outputs:** multi-stage Dockerfiles for `api` and `web` (node:20-alpine / nginx:alpine,
  arm64); `docker-compose.prod.yml` (api, web, tunnel) with `mem_limit` (api 128m, web 32m,
  tunnel 64m); build scripts: `docker buildx build --platform linux/arm64 …` + `docker save`/
  `ssh … docker load` transfer script.
- **Definition of Done:** images build locally for arm64; production compose boots on the Synology
  with static web + API reachable on internal network; total idle RSS < 150 MB.
- **Dependencies:** T14–T20 (feature-complete app).

### T22 — Cloudflare Tunnel setup
- **Goal:** HTTPS access without port forwarding.
- **Inputs:** docs/ARCHITECTURE.md (Networking).
- **Outputs:** `cloudflared` as 4th compose service; tunnel config routing
  `https://grocery.<your-domain>` → `web:8080`; DNS route documented; token via `.env`.
- **Definition of Done:** app reachable from mobile network over HTTPS; no ports opened on router.
- **Dependencies:** T21.

### T23 — Deployment guide + backup strategy
- **Goal:** Runbook for the NAS.
- **Inputs:** docs/ARCHITECTURE.md (Backups, Build & deploy).
- **Outputs:** `docs/DEPLOYMENT.md`: build/transfer/upgrade steps, env/secrets setup, volume
  layout, daily SQLite `.backup` + weekly uploads tar via Synology Task Scheduler, restore drill.
- **Definition of Done:** a fresh-eyes reader can deploy from zero; backup+restore tested once.
- **Dependencies:** T21.

### T24 — Smoke test checklist on real Synology
- **Goal:** Validate resource budgets and UX on target hardware.
- **Inputs:** docs/PROJECT.md (Non-functional).
- **Outputs:** checklist + results doc: total memory < 150 MB, cold start < 5 s, UI load < 1 s on
  LAN, login-once across app restarts, DnD + long-press on real phone, tunnel uptime.
- **Definition of Done:** all checks pass or issues filed as tasks.
- **Dependencies:** T22.

### T24.5 — PWA configuration *(new)*
- **Goal:** Installable app with instant loads.
- **Inputs:** docs/PROJECT.md (Mobile & UX Constraints), docs/CONVENTIONS.md (Frontend).
- **Outputs:** `vite-plugin-pwa`; manifest (name "My Groceries", icons, theme color); service
  worker caching the static app shell **and runtime-caching `/static/*` with a cache-first
  strategy** (immutable URLs per T10 — item images load from device cache/offline, no repeat
  downloads); "Add to Home Screen" verified on Android + iOS.
- **Definition of Done:** installed PWA opens full-screen, loads shell offline, item images load
  from cache with no network request on repeat visit, no re-login after reopening.
- **Dependencies:** T14 (code), verified at T24.
