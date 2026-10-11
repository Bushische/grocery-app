---
name: grocery-task-create
description: Use ONLY when the user asks for a new grocery-list feature or a new Tasks/TASK_Txx.md spec. Creates the next task spec file without implementing anything.
---

# Grocery Task Create

Turn a feature request into one implementable task spec. Never implement,
run, or commit anything under this skill — that belongs to `grocery-task-run`.

## Procedure

1. Read `Tasks/README.md` (source of truth for this workflow) and the newest
   `Tasks/TASK_Txx.md` for tone. Read `docs/CONTEXT.md` only if you need
   domain background; do NOT read other tasks' specs or logs.
2. Next ID = max existing task number + 1: `ls Tasks/TASK_*.md | sort -V | tail -n 1`.
   Integer IDs only (`T93`, never `T93.1`).
3. Write `Tasks/TASK_Txx.md` in exactly this shape (concrete file
   names, no boilerplate):
   ```markdown
   # Txx — Short title
   - **Goal:** one sentence: what changes for the user.
   - **Inputs:** files/specs/contracts the task builds on.
   - **Outputs:** files/endpoints/schemas the task creates.
   - **Test cases:** numbered list, one case per behavior. Each case states
     Setup, Action, and the exact Expected observable behavior in plain text
     (what the user sees on screen or what the API returns — never
     implementation details). Minimum scope: happy path, every permission
     role / boundary involved, failure path, retry-after-failure path.
   - **Definition of Done:** the Test cases above pinned by real tests
     (`*.test.ts(x)` colocated with code) plus the full gate
     (`pnpm test && pnpm lint`), never "works correctly".
   - **Dependencies:** task IDs that must be DONE first (usually the latest DONE task).
   ```
4. Create NO log file — the absence of `Tasks/EXECUTION_LOG_Txx.md` IS the
   `PENDING` state. Never write `EXECUTION_LOG_*` under this skill.
5. Run `node scripts/check-log-integrity.mjs` to validate, then report the new
   task ID and stop. Wait for an explicit execute request.

## Hard rules

- One feature = one task. If the request spans independent areas, say so and
  still emit a single spec for what was asked — do not freelance extra tasks.
- Test cases describe behavior, not code: no function names, no state variables,
  no "unit test for X". If a case cannot be observed by a user or an API
  response, rewrite it until it can.
- DoD must reference the Test cases by number plus the full gate, never
  "works correctly".
- Touch NOTHING outside `Tasks/TASK_Txx.md`.
