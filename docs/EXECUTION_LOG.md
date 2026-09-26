# Execution Log

Single source of truth for progress. The orchestrator (`scripts/run-next-task.sh`) and the
execution prompt in `docs/EXECUTION_PROMPT.md` read and update this file.

Statuses: `PENDING` → `IN_PROGRESS` → `DONE` | `BLOCKED`

| Task | Title | Status | Date | Notes |
|---|---|---|---|---|
| T1 | Repository scaffolding | PENDING | | |
| T2 | Docker Compose + dev tooling | PENDING | | |
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
