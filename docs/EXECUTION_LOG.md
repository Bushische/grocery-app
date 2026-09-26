# Execution Log

Single source of truth for progress. The orchestrator (`scripts/run-next-task.sh`) and the
execution prompt in `docs/EXECUTION_PROMPT.md` read and update this file.

Statuses: `PENDING` → `IN_PROGRESS` → `DONE` | `BLOCKED`

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| T1 | Repository scaffolding | DONE | 2026-09-27 | pnpm workspace + app stubs; `pnpm lint` & `pnpm test` pass |
| T2 | Docker Compose + dev tooling | DONE | 2026-09-27 | compose dev env (api/web/tunnel placeholder, volumes, healthchecks); verified boot + persistence |
| T3 | Drizzle schema + initial migration + seed | PENDING | | |
| T4 | Fastify bootstrap | PENDING | | |
| T5 | Auth module | PENDING | | |
| T6 | Lists CRUD + members/permissions | PENDING | | |
| T7 | Categories CRUD | PENDING | | |
| T8 | Items CRUD + smart-add | PENDING | | |
| T9 | Move items TO_BUY ↔ BOUGHT | PENDING | | |
| T10 | Image upload | PENDING | | |
| T11 | Price observations + history | PENDING | | |
| T12 | Suggest + search endpoints | PENDING | | |
| T13 | AI agent API tokens | PENDING | | |
| T14 | Web app scaffold, auth flow, login page | PENDING | | |
| T15 | Lists view | PENDING | | |
| T16 | Main screen: mobile UI + DnD reordering | PENDING | | |
| T16.5 | Reorder API endpoint | PENDING | | |
| T17 | Bottom input box with grouped suggestions | PENDING | | |
| T18 | Item details page | PENDING | | |
| T19 | Category management page | PENDING | | |
| T20 | Permissions UI | PENDING | | |
| T21 | Production Dockerfiles + local build/deploy scripts | PENDING | | |
| T22 | Cloudflare Tunnel setup | PENDING | | |
| T23 | Deployment guide + backup strategy | PENDING | | |
| T24 | Smoke test checklist on real Synology | PENDING | | |
| T24.5 | PWA configuration | PENDING | | |

## Rules
- One task per agent session; one commit per task (made by the orchestrator after verification).
- The executing agent updates only its own row and appends to "Session notes".
- `BLOCKED` rows carry the reason in Notes; resume with `./scripts/run-next-task.sh Tn`.
- Contracts (docs/DATA_MODEL.md, docs/API.md) may only change in the task that owns them.

## Session notes
Format (append newest last): `YYYY-MM-DD | Tn | model | summary`

- (no sessions yet)
- 2026-09-27 | T1 | z-ai/glm-5.3-flash | agent session exited with an error — task left IN_PROGRESS
- 2026-09-27 | T1 | z-ai/glm-5.3-flash | scaffolding: pnpm-workspace.yaml, root package.json (dev/build/test/lint scripts), biome.json, tsconfig.base.json (strict), .editorconfig, .env.example, docker-compose.yml placeholder, stubs in apps/api, apps/web, packages/shared (+1 smoke test in shared); lint+test+build green
- 2026-09-27 | T1 | openrouter/z-ai/glm-5.3-flash | completed and committed (c042a92)
- 2026-09-27 | T2 | z-ai/glm-5.3-flash | docker-compose.yml (api node:20-alpine + healthcheck, web placeholder dev server proxying /api & /static, tunnel profile placeholder, data+uploads volumes, .env flow), placeholder src/dev-server.mjs in api & web (replaced in T4/T14), README dev-env section; verified `docker compose up` boots healthy, /api proxy works, data survives restart; lint+test green
