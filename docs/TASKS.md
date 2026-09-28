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

## Phase E — Feedback round 1 (found testing the deployed app)

### T25 — Category management: always-available "add category" button *(bugfix)*
- **Goal:** Fix: users cannot create more than one category (no Add/+ button visible anywhere).
- **Inputs:** docs/PROJECT.md (Categories), T19 (category management page).
- **Outputs:** a persistent, reachable "Add category" affordance (button on the category
  management page, and/or `+` in the category list on the main screen), regardless of how many
  categories exist; the empty state also offers it.
- **Definition of Done:** with ≥ 1 category existing, a new category can be created from the UI
  (main screen and/or management page); verified in the browser on mobile viewport.
- **Dependencies:** T19.

### T26 — Smart-add must allow creating a new item despite existing suggestions *(bugfix)*
- **Goal:** Fix: typing "melon" with existing "watermelon" shows suggestions but gives no way to
  create the new item "melon".
- **Inputs:** docs/API.md (smart-add semantics), T17 (bottom input box).
- **Outputs:** the input keeps a distinct "Create 'melon'" action (explicit create row/button or
  a dedicated Enter-with-no-selection behavior) whenever the query does not exactly match an
  item; duplicate names must also be creatable (same name twice = two items, unless the user
  picks a suggestion).
- **Definition of Done:** with "watermelon" existing: "melon" → can create a separate item;
  re-adding "watermelon" (exact match) still re-activates per smart-add; duplicate creation works.
- **Dependencies:** T17.

### T27 — Main list: tap the whole row toggles bought/to-buy *(UX change)*
- **Goal:** Replace the special buy/unbuy button: tapping anywhere on the row moves the item.
- **Inputs:** T16 (main screen), T9 (move semantics).
- **Outputs:** whole-row tap = `POST /items/:id/move` (TO_BUY → BOUGHT with timestamp/counter
  updates; BOUGHT → back to TO_BUY). Drag must still be handle-only; long-press (500 ms) still
  opens details; row tap must not fire after a drag or long-press (gesture disambiguation).
- **Definition of Done:** on a mobile viewport: tap toggles status both directions, DnD via
  handle still works, long-press still opens details, no accidental toggles during scroll.
- **Dependencies:** T16, T9.

### T28 — Price chart layout fix *(bugfix)*
- **Goal:** Fix: the price history chart looks broken and overlaps the price input.
- **Inputs:** T18 (item details, uplot chart).
- **Outputs:** chart gets its own layout space (no absolute overlap): reserved height, responsive
  width, sensible y-axis padding; chart renders below the price+shop form; empty/single-point
  state shows a placeholder instead of a broken chart.
- **Definition of Done:** on mobile viewport (375 px width) with 1..N price points: chart never
  overlaps the input, single point renders cleanly, labels readable.
- **Dependencies:** T18.

### T29 — Suggestions popover above the input, max 3 *(UX change)*
- **Goal:** Fix: suggestion list pushes the input up; should overlay it.
- **Inputs:** T17 (bottom input box), docs/PROJECT.md (UX).
- **Outputs:** suggestions render as a floating layer anchored above the input (absolute/
  popover, not in-flow — input stays pinned to the bottom edge); list capped at 3 items
  (server allows more via T12 `?limit=`, client trims); includes the T26 "Create" row; closes
  on blur/select/Escape; tap targets > 40 px.
- **Definition of Done:** typing shows ≤ 3 suggestions in an overlay above the input without
  moving it; selecting/creating/dismissing works by tap; keyboard (Escape) closes it.
- **Dependencies:** T17, T26.

## Phase F — Security hardening (audit follow-ups)

> From the authorization audit: per-list item/category management (EDITOR/OWNER roles) stays as
> contracted in docs/API.md — the global `users.role='admin'` governs user management only.
> `/static` images intentionally stay public (decision: no auth gate, hash names suffice).

### T30 — Single-line header + overlay menu *(UX redesign)*
- **Goal:** The stacked header (title + account + sign out) and the row of list controls eat half
  of a phone screen. One line on top; everything else lives in an overlay menu.
- **Inputs:** T15 (lists view), T16 (main screen), docs/PROJECT.md (Mobile & UX Constraints),
  T20 (members), T19 (categories), T32 (admin users page).
- **Outputs:** exactly one header line: current list name + a menu (accordion/hamburger) button.
  Tapping it opens an overlay menu (drawer/popover over the content) containing, top to bottom:
  account block (login email + Sign out); list-management block (list switcher, create list,
  delete list — OWNER-only, Categories, Members — OWNER-only, per-list roles as today);
  admin-tools block (Users management → T32 page) rendered only when the global
  `users.role === 'admin'`. Menu closes on selection/Escape/backdrop tap; ≥ 40 px targets.
- **Definition of Done:** mobile viewport (375 px) shows exactly one header line with list name
  + menu button; all previously header-mounted actions are reachable from the overlay menu with
  their existing permission gates; DnD/long-press/add-item bar unaffected; existing page tests
  updated and green.
- **Dependencies:** T15, T16, T20, T19, T32.

### T31 — Admin user management API *(new — contract endpoints missing)*
- **Goal:** docs/API.md (Users — admin only: `GET/POST/DELETE /users`) was never implemented —
  admins currently cannot create users (only the §8 bootstrap SQL or the seed script).
- **Inputs:** docs/API.md (Users), docs/DATA_MODEL.md (users), docs/PROJECT.md (Auth).
- **Outputs:** `routes/users.ts` + `services/userService.ts`: list users, create user (email +
  password + role, bcrypt hash, unique email → 409), delete user (409 when the user owns lists,
  per docs/API.md; 204 otherwise); shared zod schemas (userDto, createUserRequest) in
  `packages/shared`; every route requires the global admin role (T33's `requireAdmin` — build it
  here if T33 has not run yet, then T33 only adds tests).
- **Definition of Done:** integration tests: admin CRUD happy paths; non-admin → 403; duplicate
  email → 409; delete list-owning user → 409; hash-only persistence.
- **Dependencies:** T5.

### T32 — Admin users page *(new UI)*
- **Goal:** Admins need a UI to create users (the "cannot create a new user" report).
- **Inputs:** T31 (users API), docs/PROJECT.md (Auth), T30 (menu hosts the entry point).
- **Outputs:** feature `users`: admin-only page (route `/users`) — user list (email, role,
  createdAt), create-user form (RHF + shared schema: email, password, role select user/admin),
  delete with confirm + 409 ("owns lists") handling; link from the T30 overlay menu's admin
  block; non-admin deep link → blocked notice (T20 pattern).
- **Definition of Done:** admin creates a user, the new user can log in (manual curl check);
  duplicate email shows 409 message; non-admin sees the blocked notice, no API calls; tests for
  all of it.
- **Dependencies:** T31, T14, T30 (menu placement).


### T33 — Admin-only user endpoints authorization *(security)*
- **Goal:** Enforce the global admin role where it must apply: user management (T31/T32
  endpoints) — and nowhere else (list-item management remains per-list-role per docs/API.md).
- **Inputs:** docs/API.md (Users — admin only), docs/PROJECT.md (Auth), audit gap 3.
- **Outputs:** `requireAdmin` preHandler in `apps/api/src/plugins/auth.ts` (checks
  `request.user.role === 'admin'` → 403 otherwise, works for JWT and API-token auth — API-token
  auth re-reads the users row so it is always fresh); wired onto every `/users` route in T31;
  shared zod user schemas. Add integration tests: admin → 2xx on user management, plain `user`
  → 403, VIEWER/EDITOR/OWNER list roles grant nothing there.
- **Definition of Done:** non-admin cannot list/create/delete users (403); admin can; existing
  item/list role tests stay green (no admin requirement leaked onto item routes).
- **Dependencies:** T31.

### T34 — CORS_ORIGIN required in production *(security)*
- **Goal:** Fix: unset `CORS_ORIGIN` currently means "reflect any origin" with
  `credentials: true` (config.ts) — any website can make credentialed requests against a prod
  deploy that forgot the variable (prod compose defaults it to empty).
- **Inputs:** audit gap 2, apps/api/src/config.ts, docker-compose.prod.yml.
- **Outputs:** in production (`NODE_ENV=production`) an empty/whitespace `CORS_ORIGIN` is a
  boot-time config error (same pattern as the JWT_SECRET check); non-prod keeps the permissive
  default; reflect-list semantics unchanged when set; update `.env.prod.example` and
  docker-compose.prod.yml comments accordingly.
- **Definition of Done:** boot with NODE_ENV=production and no CORS_ORIGIN → exits with an
  explicit error message; boot with a value → fine; dev/`NODE_ENV` unset still boots; tests
  cover all three.
- **Dependencies:** T4.5 (config).

### T35 — Forbid creating a second OWNER via member add *(security/bug)*
- **Goal:** Fix: `POST /lists/:id/members` accepts `role: "OWNER"`, creating a second owner and
  breaking the one-owner invariant the PATCH/DELETE member routes protect.
- **Inputs:** audit gap 4, docs/API.md (Lists — members), docs/PROJECT.md (one owner per list).
- **Outputs:** addListMemberRequestSchema rejects `role: "OWNER"` (validation error 400) —
  ownership is established by list creation and never granted via the members API; keep the
  existing owner-immutable protections in PATCH/DELETE; test that adding a member as OWNER → 400
  and the owner count stays 1.
- **Definition of Done:** OWNER add → 400; existing member add/edit/remove tests green.
- **Dependencies:** T6.

### T36 — BOUGHT rows: strikethrough + faded styling *(bugfix)*
- **Goal:** Bought items are visually indistinguishable from to-buy ones — the title should be
  struck through and the whole row faded/pale/grey (the "Buy Me a Pie" convention).
- **Inputs:** T16 (main screen item rows), docs/PROJECT.md (UX).
- **Outputs:** in `apps/web/src/features/items/components/item-row.tsx` (and the section
  container if needed): `item.status === "BOUGHT"` renders title with `line-through`, row content
  (title, qty, badge) in muted gray (e.g. `text-gray-400`, bar/color swatch desaturated),
  optionally reduced row opacity; TO_BUY rows unchanged; move buttons and other interactions
  unchanged.
- **Definition of Done:** on the main screen a bought item shows strikethrough title + faded
  row; buying an item via tap/move applies the style immediately (optimistic update kept);
  un-buying restores the normal look; row tests cover both states.
- **Dependencies:** T16, T27 (row-tap toggle — style must not fight the tap affordance).

### T37 — Self-healing default "Other" category *(bugfix)*
- **Goal:** Fix: deleting the (empty) default "Other" category (possible via T19's category UI)
  makes every smart-add and plain create on that list return 500 — `defaultCategoryId`
  (itemService.ts) assumes the category always exists.
- **Inputs:** docs/PROJECT.md (every list has a default "Other"), T25 (category delete UI),
  docs/API.md (smart-add step 4).
- **Outputs:** the default category must exist for the list's lifetime. Preferred: make
  `defaultCategoryId` self-healing — when missing, re-create it (title "Other", color #6B7280,
  appended sortOrder) inside the same transaction as the create/smart-add, and return its id;
  document that "Other" is recreatable. Alternative (if self-heal is rejected): category delete
  returns 409 for the default category AND the UI disables it (web + api guard).
- **Definition of Done:** test: delete "Other" from a list (empty) → smart-add returns 201 and
  recreates "Other"; plain `POST /items` works; concurrent deletes don't duplicate "Other"
  (unique per list+title); existing category-delete tests stay green.
- **Dependencies:** T8, T19.

### T38 — Uploads writability self-check at api boot *(ops hardening)*
- **Goal:** Fix: a root-owned (or read-only) uploads dir surfaces as an opaque 500
  (`EACCES ... writeFileSync`) only when a user first tries to upload — it should fail fast at
  boot with an actionable message (seen in local Docker: named `uploads` volume pre-dating the
  non-root `app` user stays root-owned forever).
- **Inputs:** docs/ARCHITECTURE.md (Persistence), T21 (non-root runtime user), T10 (image write).
- **Outputs:** at api startup, after resolving `uploadsPath`: create it if missing (already done)
  and write-probe it (create+delete a temp file) as the runtime user; on failure, log an explicit
  error naming the path, uid, and the fix (`chown -R 100:101 <path>` or a bind mount) and exit
  non-zero in production; in dev, log a loud warning and continue.
- **Definition of Done:** test: read-only uploads path → boot fails (prod) with the actionable
  message; writable path → boots normally; existing boot tests green.
- **Dependencies:** T4.5 (config), T21.

### T39 — "To buy" section header statistics, client-derived *(refactor)*
- **Goal:** Replace the server-derived "N to buy · M bought" line (stale-prone — it reads
  `["lists"]` `itemCounts` that item mutations never refresh) with a client-computed count in
  the "To buy" section header: one line at the top of the list, e.g. `To buy (3)`.
- **Inputs:** T16 (item sections), T27 (row-tap move), lists-page.tsx:43 (old counts line).
- **Outputs:**
  - the "To buy" section header renders the count of TO_BUY rows **derived from the loaded
    items cache** (`items.filter(i => i.status === "TO_BUY").length`) — no extra API call;
    the existing optimistic move/create/delete cache updates recompute it automatically.
  - the old server-counts line is removed from the main screen (the `itemCounts` payload stays
    in `/lists` for the overlay menu's list switcher — no API/shared changes).
- **Behavior:** recalculated whenever the cache changes (move to/from bought, create, delete);
  on list switch the count derives from the freshly fetched list ("only to buy" is tracked —
  bought has no counter).
- **Definition of Done:** open list → correct count; move to bought → count decrements in the
  same optimistic frame as the row (deferred-POST harness as in T36), rollback restores it;
  create/delete update it; list switch + back recalculates from server data; old counts line
  gone; tests cover all of it.
- **Dependencies:** T15, T27, T36.

### T40 — Rename list from the overlay menu *(feature gap)*
- **Goal:** Fix: renaming a list is impossible from the UI — the menu has
  switch/create/delete/Categories/Members but no rename, although `PATCH /lists/:id { title }`
  (OWNER-only, docs/API.md) has existed since T6.
- **Inputs:** T30 (overlay menu), docs/API.md (Lists), CreateListForm (form pattern to reuse).
- **Outputs:** OWNER-only "Rename" row in the menu's selected-list block → inline edit form
  (RHF + the shared list-title schema, trim/empty rules identical to create); wire
  `listsApi.update(id, title)` → `PATCH /lists/:id`; `useUpdateList` mutation with optimistic
  title update on `["lists"]` + `["list", id]` + rollback, so the header line (list name) and
  menu row update instantly; validation error / failure banners; hidden for VIEWER/EDITOR.
- **Definition of Done:** OWNER renames from the menu → header + switcher row update without
  refetch; PATCH body trimmed; failure rolls back and shows a banner; non-owners see no rename;
  tests for all of it.
- **Dependencies:** T30, T6 (PATCH endpoint exists).

### T41 — List selection in the URL; details listId from the route *(bugfix, 2 user reports)*
- **Goal:** Two bugs, one root cause — the selected list lives in component state
  (`lists-page.tsx` `useState<string | null>`), not in the URL:
  1. Back from item details lands on the FIRST list (`navigate(-1)` → `/` remounts ListsPage →
     selection resets to `listsData[0]`).
  2. Item category is read-only on the details page whenever `location.state.listId` is missing
     (reload, deep link, stale history state) — the select renders only with a known list
     context (item-details-page.tsx:24, item-edit-form.tsx:57).
- **Inputs:** T30 (menu navigation), T18 (details), react-router.
- **Outputs:** main screen gets a real route `/lists/:listId` (plain `/` redirects to the first
  list); list switching = navigation (menu `selectAndClose` → navigate), no component state;
  item details derives its listId from the item payload (`detail.data` carries the list) or a
  `/lists/:listId/items/:itemId` nested route — **no `location.state` dependency**; Back
  navigates explicitly to `/lists/:listId`; categories fetch always has a real listId.
- **Definition of Done:** repro 1 fixed: open a non-first list → edit an item → Back returns to
  **that** list (not the first); reload on details keeps everything working; deep link to
  `/items/:id` shows an editable category (listId from the payload); switching lists via the
  menu updates the URL; tests cover back-navigation and deep-link category edit.
- **Dependencies:** T30, T18, T14.

### T42 — Humanized age badge ("5m" / "19h" / "3d") *(UX fix)*
- **Goal:** Fix: items younger than 24 h show "0d" (the badge is `floor(now − addedAt)` days,
  so everything created today reads 0d) — the age should read naturally.
- **Inputs:** docs/PROJECT.md (row badge "3d"), item-row.tsx, itemService.ts
  (computeDaysInList — contract keeps integer days).
- **Outputs:** the age badge derives from `item.addedAt` **client-side** and humanizes:
  `< 60 min` → `5m`, `< 24 h` → `19h`, `≥ 24 h` → `3d` (whole days, same rounding as the
  server); keep `daysInList` in the API DTO untouched (no contract change); the BOUGHT section
  badge (if shown) uses the same helper; badge tooltip/aria-label uses the humanized text.
- **Definition of Done:** a 1-hour-old item shows "1h" (not "0d"); a 3-day-old item shows "3d";
  badge updates without reload is NOT required (static per load is fine) but tests pin the
  three buckets; no API changes.
- **Dependencies:** T16, T36.

### T43 — Add items directly from the category view *(feature)*
- **Goal:** The category view (T19's CategoryItemsPage) is read-only — to file "Milk" under
  Dairy you must go item → category select. The user wants to open a category and add the items
  they usually buy right there.
- **Inputs:** T19 (category items page), T17/T26/T29 (bottom input + suggestions + popover
  pattern), docs/API.md (suggest is list-scoped and grouped by category; POST items accepts
  categoryId; move re-activates).
- **Outputs:** category items page gets the same bottom input bar (T29 popover style: ≤ 3
  suggestions above the input, Create row) **scoped to this category**:
  - suggestions come from the existing `GET /items/suggest?q=&listId=` but only this category's
    group is shown;
  - tapping a TO_BUY suggestion = no-op (already listed, close);
  - tapping a BOUGHT suggestion = `POST /items/:id/move { status: "to_buy" }` (re-activate in
    its category);
  - no match / Create row = `POST /lists/:id/items { title, categoryId: <this category> }` —
    the created item belongs to the category regardless of the "Other" fallback (which stays
    the main-screen smart-add behavior);
  - VIEWER sees no input bar (read-only page, as today).
- **Definition of Done:** from a category: create → appears in the category view and on the
  main screen in that category's group; bought suggestion → re-activated in place; suggest
  limited to this category; title/qty fields per the main add flow; tests for create, reactivate,
  category-scoping, VIEWER absence.
- **Dependencies:** T19, T26, T29.

### T44 — Price observation: shop optional *(simplified: empty string, no migration)*
- **Goal:** Shop is required today ("validates price > 0, shop non-empty") — users don't always
  know/care which shop the price is from. Make it optional **by allowing an empty string**
  (column stays `NOT NULL`, DTO stays `shop: string`) — deliberately NOT nullable, to avoid a
  schema migration and DTO churn. Trade-off accepted: `""` rows exist; a later search/group-by
  shop feature must treat `""` as "unknown".
- **Inputs:** docs/API.md (Prices), T11 (prices API), T18 (price form + chart labels).
- **Outputs (one task):**
  - contract: docs/API.md Prices — `shop` optional, empty string means unknown
    ("shop non-empty" → "shop optional; may be empty").
  - `packages/shared`: `createPriceObservationRequestSchema` — shop optional, trimmed, may be
    `""`; `priceObservationSchema` / `itemSchema.currentPrice` — shop stays `string`, `""` valid.
  - api: drop the non-empty validation in priceService (price > 0 stays).
  - web: PriceForm — shop input optional (label "Shop (optional)"); submit passes the trimmed
    string, `""` when empty; PriceChart/point labels and history rows render only the price when
    shop is `""` (no dangling separator).
- **Definition of Done:** POST prices without shop → 201, observation persisted with `""`,
  appears in history + item.currentPrice; with shop → unchanged; chart + history render both
  cases cleanly; tests cover both; lint+test green.
- **Dependencies:** T11, T18.
