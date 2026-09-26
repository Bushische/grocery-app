# Execution Log

Single source of truth for progress. The orchestrator (`scripts/run-next-task.sh`) and the
execution prompt in `docs/EXECUTION_PROMPT.md` read and update this file.

Statuses: `PENDING` → `IN_PROGRESS` → `DONE` | `BLOCKED`

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| T1 | Repository scaffolding | DONE | 2026-09-27 | pnpm workspace + app stubs; `pnpm lint` & `pnpm test` pass |
| T2 | Docker Compose + dev tooling | DONE | 2026-09-27 | compose dev env (api/web/tunnel placeholder, volumes, healthchecks); verified boot + persistence |
| T3 | Drizzle schema + initial migration + seed | DONE | 2026-09-27 | schema verbatim from DATA_MODEL; drizzle.config.ts + drizzle/ migration; client.ts (WAL/FK ON/busy_timeout/NORMAL, zod DATABASE_PATH); idempotent seed (2 users, 1 list w/ OWNER+EDITOR, 3 categories incl Other, 3 items, 4 observations); 6 vitest tests; lint+test green |
| T4 | Fastify bootstrap | DONE | 2026-09-27 | plugins (cors credentials/cookie/multipart/static/jwt/helmet), FastifyHttpError→`{error:{code,message}}`, zod env config, `GET /health`; bundle `dist/server.js` (esbuild, minified — unminified was 84 MB RSS); node:20-alpine: boot 0.13–0.17 s, steady RSS 56–58 MB |
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
- 2026-09-27 | T2 | openrouter/z-ai/glm-5.3-flash | completed and committed (7cf3b01)
- 2026-09-27 | T3 | openrouter/z-ai/glm-5.3-flash | db layer: apps/api/src/db/schema.ts (verbatim from DATA_MODEL), client.ts (pragmas WAL/foreign_keys/busy_timeout/synchronous + zod-validated DATABASE_PATH), migrate.ts (runtime migrator for tests/seed), drizzle.config.ts + generated drizzle/0000 migration (8 tables, indexes, FK restrict on items.category_id); scripts at apps/api/scripts/seed.ts (idempotent per-entity get-or-create; exports seedDatabase(db) for tests) wired as pnpm --filter api db:generate/db:migrate/db:seed; 6 vitest tests (migrate applies, FK rejected, cascade/restrict, seed counts + idempotency); verified fresh-db migrate+seed+re-seed via CLI; node-gyp added to root devDeps (better-sqlite3 13.0.3 has no prebuilt for local Node 26, compiles fine); decision: seed lives under apps/api/scripts (run via filter), not root scripts/
- 2026-09-27 | T3 | openrouter/z-ai/glm-5.3-flash | completed and committed (752b6dc)
- 2026-09-27 | T4 | openrouter/z-ai/glm-5.3-flash | app shell: buildApp(config) registers helmet (CORS-safe COOP/CORP), cors (credentials:true, origin from CORS_ORIGIN), cookie, multipart (fileSize 2 MB per docs/API.md), static (/static → UPLOADS_PATH), jwt (secret from env); applyErrorHandling maps FastifyHttpError/ZodError/fastify-validation/unknown → `{error:{code,message}}` + 404 handler (codes per docs/API.md, INTERNAL_ERROR hides details); config.ts zod-parses NODE_ENV/HOST/PORT/LOG_LEVEL/JWT_SECRET/DATABASE_PATH/UPLOADS_PATH/CORS_ORIGIN and rejects the dev JWT secret in production; index.ts loads .env (no override), listens, graceful SIGINT/SIGTERM; shared: ApiError/ApiErrorCode types. Tests: app.test.ts (8) + error-handler.test.ts (4) — 19 total green; lint/build green. Production bundle: `pnpm --filter api bundle` (scripts/bundle.mjs, esbuild ESM minified → dist/server.js, better-sqlite3 external for T5; `build` = tsc && bundle). RSS findings (node:20-alpine): unminified bundle 84 MB ✗ → minified 56–58 MB steady ✓ (peak ~65 MB in the pre-GC boot window; V8 idle-GC settles at ~8 s); boot 0.13–0.17 s. Decision: docker-compose dev api still runs the T2 placeholder (running TS in-container needs a linux node_modules install — tsx/esbuild binaries are platform-specific, better-sqlite3 musl support unverified) — deferred to T21; laptop dev = `pnpm --filter api dev` (tsx watch). Note for T5: RSS headroom is only ~2 MB — re-measure after the db layer (better-sqlite3 native + drizzle) loads into the bundle; the T21 image must ship dist/server.js together with node_modules/better-sqlite3 (external).
