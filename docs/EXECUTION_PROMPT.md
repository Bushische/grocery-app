# Execution Prompt — one fresh session per task

Goal: run exactly **one task** of `docs/TASKS.md` per agent session, verify it, and commit.
Progress lives in `docs/EXECUTION_LOG.md` (single source of truth for "what is done").

## Prerequisites (laptop)
- `opencode` CLI ≥ 1.18 (used by the orchestrator)
- Node 20+, pnpm 9+ (`corepack enable`), git
- Docker Desktop (needed from T2 on)

## Automated (recommended)
```bash
./scripts/run-next-task.sh              # execute the next PENDING task with GLM-5.3-flash
./scripts/run-next-task.sh T8           # (re)execute a specific task
./scripts/run-next-task.sh --loop       # keep spawning fresh agents until failure or all DONE
OPENCODE_MODEL=openrouter/z-ai/glm-5.3-flash ./scripts/run-next-task.sh   # model override (default is this)
```
What the script does per task:
1. Marks the next `PENDING` task as `IN_PROGRESS` in the log.
2. Spawns a **fresh** agent session: `opencode run --auto -m <model> "<prompt>"` (prompt below with `{{TASK_ID}}` substituted).
3. Verifies: `pnpm install`, `pnpm lint`, `pnpm test` (skipped while no `package.json` exists yet).
4. On success: sets `DONE` + date in the log and makes **one commit** (`feat(Tn): title`).
5. On failure: leaves the tree uncommitted, keeps `IN_PROGRESS`, exits non-zero (inspect, fix or rerun).
6. `--loop` repeats 1–5 for the following task, always in a brand-new agent session.

Note: `--auto` lets the agent approve its own tool permissions. Review each commit (`git show`)
— that is the human checkpoint in the loop.

## Manual (equivalent)
1. Open a fresh opencode session in the repo root.
2. Paste the prompt below as-is (the agent finds the next `PENDING` task itself), or replace
   `{{TASK_ID}}` with a specific one.
3. When the agent stops, run `pnpm lint && pnpm test`, review `git diff`, then commit:
   `git add -A && git commit -m "feat(<Tn>): <title>"`.

## The prompt
<!-- PROMPT-START -->
You are the implementation agent for the grocery-list project. Complete exactly ONE task, then stop. Work in the current repository root.

1. Read context, in this order:
   - docs/CONTEXT.md — the digest of PROJECT/ARCHITECTURE/CONVENTIONS (read it instead of those
     three; they are only needed if the task explicitly references a detail they alone cover)
   - docs/TASKS.md — the section for task {{TASK_ID}} (if it says {{TASK_ID}} exactly; otherwise pick the first task whose Status is PENDING in docs/EXECUTION_LOG.md and treat it as {{TASK_ID}})
   - docs/EXECUTION_LOG.md — session notes of previous tasks (build on what exists)
   - docs/DATA_MODEL.md and docs/API.md (contracts — follow verbatim) — ONLY if the task touches
     API shapes, DB schema, endpoint behavior, or shared schemas

2. Scope rules:
   - Implement ONLY task {{TASK_ID}} as specified, up to its Definition of Done.
   - Never modify the contracts (docs/DATA_MODEL.md, docs/API.md) or other tasks' outputs. Shared types/schemas go into packages/shared.
   - Do NOT run git commit, do NOT create branches — the orchestrator commits after verification.
   - If the task is ambiguous or cannot reach its Definition of Done, set its Status to BLOCKED in docs/EXECUTION_LOG.md with a one-line reason in Notes, and stop.

3. Implement following docs/CONVENTIONS.md:
   - Strict TypeScript, zod validation at boundaries, routes thin + service layer (api), feature folders (web).
   - Write the tests the task's Definition of Done requires.
   - Keep existing tests green; fix the code, not the test expectations, unless the task says otherwise.

4. Verify before stopping:
   - pnpm install (first run only).
   - During the edit loop, run ONLY the tests for the code you touched
     (e.g. `pnpm vitest run apps/api/src/routes/items.test.ts` or the single test file you
     changed) plus `pnpm lint` on your edited files (`pnpm biome check --write <paths>`).
     Iterate cheaply; do not re-run the full suite after every edit.
   - Before finishing, run the full gate ONCE: `pnpm lint && pnpm test`. Everything must pass.
   - If a `scripts/verify.sh` gate exists, the orchestrator re-runs your verification itself —
     your final full pass must be from a clean state (no untracked artifacts).

5. Update docs/EXECUTION_LOG.md:
   - Set the task's Status to DONE (or BLOCKED) and fill Date (YYYY-MM-DD).
   - Append one line under "Session notes": `YYYY-MM-DD | {{TASK_ID}} | <model name> | <what was built: files, endpoints, notable decisions, issues>`.
   - Do not touch any other rows.

6. Finish with a short report (max 5 bullets): what was built, test results, anything the next task should know.
<!-- PROMPT-END -->
