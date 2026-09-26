# Conventions

## TypeScript
- strict mode; no `any`, no `@ts-ignore`.
- Use **zod** for runtime validation on every endpoint (input + output).
- DTO types and zod schemas live in `packages/shared`; both apps import from there.
- IDs: `@paralleldrive/cuid2`.

## Monorepo
- pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`.
- Scripts via filters: `pnpm --filter api dev`, `pnpm --filter web build`, root `pnpm test`, `pnpm lint`.
- Lint/format: **Biome** (`biome.json` at root).

## Backend (Fastify + Drizzle + better-sqlite3)
- One router file per resource: `src/routes/items.ts`, etc.
- Service layer: `src/services/itemService.ts` — routes stay thin (validate → call service → serialize).
- Errors: throw `FastifyHttpError(status, code, message)`; centralized error handler maps to
  `{ "error": { "code", "message" } }` (see docs/API.md).
- All endpoints require auth except `/auth/login`, `/auth/refresh`, `/auth/logout`, `/health`.
- All DB access via Drizzle; **no raw SQL except pragmas and `.backup`**.
- Multi-row updates (reorder) run inside one `db.transaction`.
- Migrations: `drizzle-kit` (`pnpm --filter api db:generate` / `db:migrate`); never edit the DB by hand.
- Logging: pino to stdout (visible via `docker logs`).
- Config from env (`JWT_SECRET`, `DATABASE_PATH`, `UPLOADS_PATH`); validated by zod at boot.

## SQLite specifics
- Tests run on in-memory SQLite (`:memory:`); migrations applied before each suite.
- Always rely on the pragmas from docs/ARCHITECTURE.md (set once in the db module).
- Store money as integer cents; timestamps as unix epoch (`timestamp` mode).

## Frontend (React + Vite)
- Feature folders: `src/features/<feature>/{api,hooks,components,pages}`.
- TanStack Query keys: `["lists"]`, `["list", id]`, `["items", listId, status]`, `["item", id]`, …
- Forms: react-hook-form + zod (schemas imported from `packages/shared`).
- Access token in memory (Zustand); on `401` run a single-flight `/auth/refresh` and retry once.
- Optimistic updates for move/toggle/reorder via TanStack Query `onMutate`.
- Long-press: 500 ms timer, canceled on move/scroll. DnD only via the ≡ handle
  (`TouchSensor`: delay 150 ms, tolerance 5 px).
- All text i18n-ready (English for v1).

## Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Solo workflow on `main`: exactly **one commit per task**, made by the orchestrator
  (`scripts/run-next-task.sh`) only after `pnpm test && pnpm lint` pass.
- The executing agent never runs `git commit` and never creates branches.

## Tests
- Backend: vitest + supertest (Fastify `inject`); every endpoint ≥ happy path + 1 auth-failure case.
- Frontend: vitest + @testing-library/react; only critical flows (auth, add item, move item).
- `pnpm test && pnpm lint` must pass before merging any task.
