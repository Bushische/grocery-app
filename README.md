# Grocery List

A lightweight self-hosted grocery list web app + REST API, modeled after "Buy Me a Pie".
Designed for a **Synology DS223j** (ARM64, 1 GB RAM), exposed via Cloudflare Tunnel —
no open ports. The REST API is a first-class citizen: AI agents get their own scoped tokens.

Development happens **on the laptop**; the AI-built codebase is orchestrated task-by-task
with [opencode](https://opencode.ai).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS + HeadlessUI, TanStack Query + Zustand, `uplot` (price chart), PWA |
| Backend | Node.js 20 + Fastify + TypeScript, zod |
| ORM / DB | **Drizzle ORM** + **SQLite** (`better-sqlite3`, WAL) — in-process, < 5 MB RAM |
| Auth | bcrypt, JWT access (15 min) + rotating refresh cookie (30 d) + `glc_…` API tokens for agents |
| Deploy | Docker Compose (`api`, `web`/nginx, `cloudflared` tunnel), images built locally for arm64 |

Why SQLite instead of a "real" DB pod: the DS223j has 1 GB RAM shared with DSM; a separate
PostgreSQL would eat ~50–120 MB idle. SQLite in-process covers this workload comfortably and
keeps the total container budget under 150 MB.

## Repository layout

```
docs/            project documentation (single source of truth)
  PROJECT.md         vision, stack, UX + mobile constraints, budgets
  ARCHITECTURE.md    containers, networking, SQLite pragmas, backup, build/deploy
  DATA_MODEL.md      Drizzle schema (verbatim reference for agents)
  API.md             REST contract (verbatim reference for agents)
  CONVENTIONS.md     code style, testing, git workflow
  TASKS.md           26 self-sufficient tasks with Definitions of Done
  EXECUTION_PROMPT.md  the reusable fresh-session agent prompt
  EXECUTION_LOG.md   progress tracker (statuses + session notes)
scripts/
  run-next-task.sh   orchestrator: one fresh AI agent per task, verify, commit
```

## AI-driven development

Development is automated: each task runs in a **fresh agent session** (GLM-5.3-flash via
OpenRouter), is verified (`pnpm lint` + `pnpm test`), and lands as exactly one commit.

```bash
./scripts/run-next-task.sh          # execute the next PENDING task
./scripts/run-next-task.sh --loop   # chain agents until failure or all tasks DONE
./scripts/run-next-task.sh T8       # (re)execute a specific task
```

Progress lives in `docs/EXECUTION_LOG.md`; the per-task prompt is in `docs/EXECUTION_PROMPT.md`.
Requires: `opencode` CLI, pnpm (`corepack enable`), Docker (from T2).

## Dev environment (Docker)

```bash
cp .env.example .env       # set JWT_SECRET (see .env flow below)
docker compose up          # boots api (node:20-alpine, tsx-watch style) + web (dev server)
```

- `web` (http://localhost:5173) proxies `/api` and `/static` to the `api` service — the same
  topology as production nginx (T21).
- Volumes `data` (`/data/grocery.db`) and `uploads` (`/data/images`) persist across restarts.
- `.env` flow: `docker-compose.yml` reads `JWT_SECRET`, `PORT`, `DATABASE_PATH`,
  `UPLOADS_PATH`, `WEB_PORT`, `TUNNEL_TOKEN` from `.env` (gitignored; template in
  `.env.example`). Copy it once; never commit `.env`.
- The `tunnel` service (T22) starts explicitly with `docker compose --profile tunnel up`
  after setting `TUNNEL_TOKEN` in `.env` — see `.env.example` for the token + DNS route setup.

## Roadmap

26 tasks in 4 phases — see `docs/TASKS.md` for details and each task's Definition of Done:

1. **Phase A — Foundations (T1–T5):** monorepo, Docker dev env, Drizzle schema + seed,
   Fastify bootstrap, auth.
2. **Phase B — Core domain (T6–T13):** lists + permissions, categories, items + smart-add,
   move, image upload, price history, suggest/search, AI-agent API tokens.
3. **Phase C — Frontend (T14–T20, T16.5, T24.5):** app shell + silent auth, lists view,
   main screen with drag-and-drop, input box with suggestions, item details + price chart,
   category management, permissions UI, PWA.
4. **Phase D — Deployment (T21–T24):** arm64 Dockerfiles + local build scripts, Cloudflare
   Tunnel setup (T22: `docker compose --profile tunnel up` with `TUNNEL_TOKEN`,
   public hostname `https://grocery.<your-domain>` → `web:8080`), deployment + backup guide, smoke tests on the NAS.

Current status: see the task table in `docs/EXECUTION_LOG.md`.

## Documentation

- **Specs for humans and agents:** start at `docs/PROJECT.md`, then `docs/ARCHITECTURE.md`.
- **Contracts:** `docs/API.md` and `docs/DATA_MODEL.md` are normative — agents must follow them
  verbatim; changes belong to the task that owns them.
- **Working on a task?** Read `docs/EXECUTION_PROMPT.md` first; it wires the whole context
  together.
