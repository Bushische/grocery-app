# CONTEXT.md — task-agent digest

> Single file to read INSTEAD of PROJECT/ARCHITECTURE/CONVENTIONS (they are distilled here).
> The contracts (docs/DATA_MODEL.md, docs/API.md) remain authoritative — read them only when
> the task touches API shapes, DB schema, or endpoint behavior. Status/queue lives in
> docs/EXECUTION_LOG.md; task specs in docs/TASKS.md.
> **Maintenance:** when PROJECT/ARCHITECTURE/CONVENTIONS change, update this digest in the
> same commit.

## What this is
Self-hosted grocery-list web app + REST API ("Buy Me a Pie"-style UX) for a Synology NAS
(ARM64, 1 GB RAM). Developed on the laptop, built locally, no CI/CD. REST API serves the UI
and AI agents (scoped `glc_` tokens).

## Repo layout (pnpm workspaces)
- `apps/api` — Fastify + TypeScript + Drizzle ORM + better-sqlite3 (SQLite in-process, WAL).
- `apps/web` — React 18 + Vite + TS + Tailwind + HeadlessUI; TanStack Query v5; Zustand;
  `uplot` (price chart); `@dnd-kit` (reorder); PWA via `vite-plugin-pwa`.
- `packages/shared` — zod schemas + DTO types (both apps import; the ONLY place for shared
  types).
- `docker-compose.yml` (dev) / `docker-compose.prod.yml` (arm64 images) + `tunnel`
  (cloudflared, profile "tunnel"). nginx serves web + proxies `/api` + `/static` → api.
- Volumes: `data` → `/data/grocery.db` (+ WAL siblings), `uploads` → `/data/images`.

## Commands
- `pnpm install` / `pnpm lint` (Biome) / `pnpm test` (vitest, root run covers all packages).
- Targeted tests: `pnpm vitest run <file>`. Dev: `pnpm --filter api dev`, `pnpm --filter web dev`.
- api build = `tsc && esbuild bundle` → `dist/server.js`; migrations run at boot (idempotent).
- db: `pnpm --filter api db:generate|db:migrate|db:seed` (seed = admin@/member@ + demo data).

## Non-negotiable constraints
- RAM budget: **< 150 MB total** containers (api 128m, web 32m, tunnel 64m); steady api RSS
  ~60–75 MB. No db server ever. Cold start < 5 s.
- Strict TS, no `any`; zod validation at every endpoint boundary (input + output).
- Money = integer cents (`priceCents`); timestamps = unix epoch, ISO 8601 on the wire.
- IDs = cuid2. Images = webp, content-addressed `<itemId>-<hash>.webp` (immutable cache).

## Backend rules
- One router per resource (`src/routes/<res>.ts`, thin: validate → service → serialize) +
  service layer (`src/services/<res>Service.ts`). Multi-row writes in one `db.transaction`.
- Errors: `FastifyHttpError(status, code, message)` → `{ "error": { "code", "message" } }`;
  codes: VALIDATION_ERROR 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409.
- Auth: bcrypt; access JWT 15 min (memory) + refresh 30 d (HttpOnly/Secure/Strict cookie,
  Path=/api/auth, rotated, sha256 hash in DB) + API tokens `glc_` (sha256-hashed, no expiry).
  API-token auth re-reads the users row (role checks are always fresh there); JWT carries the
  role for 15 min.
- All endpoints require auth except `/auth/login|refresh|logout`, `/health`.

## Permissions model (two levels)
- Global `users.role`: `user` | `admin` — admin governs user management (`/users` endpoints)
  only (via `requireAdmin`). Per-list roles govern everything else.
- Per-list `list_members.role`: **VIEWER** read-only; **EDITOR** mutate items/categories/prices/
  images/reorder; **OWNER** manage members, edit/delete list, delete categories.
- Guards: `requireListRole` (list-scoped routes), `requireItemRole` / `requireCategoryRole`
  (resolve resource → owning list, cross-list safe), `requireMembership` (suggest/search).
  Resource ownership is NEVER taken from the payload.

## Frontend rules
- Feature folders: `src/features/<feature>/{api,hooks,components,pages}`.
- TanStack Query keys: `["lists"]`, `["list", id]`, `["items", listId, status]`, `["item", id]`;
  optimistic updates via `onMutate` with rollback for move/reorder/toggle.
- Forms: react-hook-form + zodResolver over schemas from `packages/shared`.
- Access token in memory only; on 401 → single-flight `/auth/refresh` → retry once.
- Mobile-first: touch targets > 40 px; DnD only via ≡ handle (TouchSensor 150 ms delay,
  5 px tolerance); long-press 500 ms on row body = details; never both.

## Testing
- api: vitest + Fastify `inject` on in-memory SQLite (`:memory:`), migrations per suite;
  every endpoint ≥ happy path + 1 auth-failure case.
- web: vitest + @testing-library/react for critical flows only.
- Gate: `pnpm test && pnpm lint` (or `scripts/verify.sh`) must pass; orchestrator commits.

## Workflow (the loop)
- One task per fresh agent session; agent never commits/branches — the orchestrator
  (`scripts/run-next-task.sh`) verifies then makes exactly one commit `feat(Tn): title`.
- Agent context budget: read docs/CONTEXT.md + its own `Tasks/TASK_<ID>.md`; contracts
  (DATA_MODEL/API.md) only when the task touches API/DB shapes; another task's
  `Tasks/EXECUTION_LOG_<ID>.md` only to check a dependency's result. Never read
  `docs/TASKS.md` / `docs/EXECUTION_LOG.md` (frozen T1–T46 archive) or scan `Tasks/`.
- Agent updates ONLY its own `Tasks/EXECUTION_LOG_<ID>.md` (status + one ≤200-char note).
- Queue: first non-DONE spec in `Tasks/` (version-sorted ID order, `BLOCKED` skipped);
  `PENDING` = spec exists with no log file yet.
- Verify cheaply during the edit loop (touched files only), full gate once at the end.