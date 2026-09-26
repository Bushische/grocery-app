# Architecture

## Repos
Monorepo (pnpm workspaces):
- `apps/api`        Fastify + TypeScript + Drizzle ORM + better-sqlite3
- `apps/web`        React + Vite + TypeScript + Tailwind (PWA)
- `packages/shared` zod schemas + shared DTO types

## Containers (docker-compose)
1. `api`     node:20-alpine (arm64) — Fastify app; volumes: `data` (SQLite db) + `uploads` (images)
2. `web`     nginx:alpine serving built static files + reverse proxy `/api` and `/static` → `api:3000`
3. `tunnel`  cloudflare/cloudflared:latest

**No database container.** SQLite runs in-process via `better-sqlite3`; the DB file lives on the
`data` volume (`/data/grocery.db`, WAL mode). This is the single biggest memory saving on a
1 GB NAS (a separate Postgres would cost ~50–120 MB idle; SQLite costs < 5 MB).

## Networking
- Internal network: bridge.
- Only `tunnel` egresses to the internet (via Cloudflare).
- `web` listens on internal port 8080; tunnel forwards `https://grocery.<your-domain>` → `web:8080`.
- `web` (nginx) proxies `/api/*` → `api:3000` and `/static/*` → `api:3000`.
- SQLite: single writer (the `api` container). WAL mode allows concurrent readers in-process.

## Data flow
```
Web → nginx → /api     → Fastify → Drizzle → SQLite file (data volume)
             → /static → /data/images (uploads volume)
Cloudflare → cloudflared → nginx
```

## SQLite pragmas (set at api startup)
- `journal_mode = WAL`
- `foreign_keys = ON`
- `busy_timeout = 5000`
- `synchronous = NORMAL`

## Secrets
- `.env` file (gitignored), mounted read-only into `api` (`JWT_SECRET`, …); tunnel token via env.

## Persistence
- `data` volume    → `/data/grocery.db` (+ `-wal`, `-shm`)
- `uploads` volume → `/data/images` (item images, webp)

## Backups
- Daily: `sqlite3 /data/grocery.db ".backup /backups/grocery-YYYY-MM-DD.db"` via Synology Task
  Scheduler (safe under WAL).
- Weekly: tar of the uploads volume.

## Build & deploy (no CI/CD — laptop only)
- Dev: `docker compose up` (api with `tsx watch`, web with Vite dev server + proxy).
- Prod: multi-stage Dockerfiles; build arm64 images locally:
  `docker buildx build --platform linux/arm64 -t grocery-api:latest --load apps/api`
  then transfer: `docker save grocery-api | ssh <nas> docker load` (or a private registry if
  you prefer).
- Full runbook lives in `docs/DEPLOYMENT.md` (created in T23).

## Dev tooling
- pnpm workspaces, Biome (lint + format), vitest.
- Tests for the API run against an in-memory SQLite (`:memory:`) with migrations applied per suite.
