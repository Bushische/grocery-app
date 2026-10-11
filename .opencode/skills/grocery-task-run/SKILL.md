---
name: grocery-task-run
description: Use ONLY when the user explicitly asks to execute/run a grocery-list task from Tasks/TASK_Txx.md. Implements the next pending task with EXECUTION_LOG_Txx.md status tracking (IN PROGRESS to DONE).
---

# Grocery Task Run

Execute exactly one pending task. Trigger on explicit execute requests only
("run it", "execute Txx", "go") — never auto-start from a creation request
(that belongs to `grocery-task-create`).

## Procedure

1. Read `Tasks/README.md` and `docs/CONTEXT.md`. Read the target
   `Tasks/TASK_Txx.md`. Do NOT read `docs/TASKS.md` / `docs/EXECUTION_LOG.md`
   (frozen T1–T46 archive) or other tasks' specs.
2. Pick the task: the explicitly named one, else the first non-`DONE` spec in
   version-sorted ID order (`ls Tasks/TASK_*.md | sort -V`), skipping `BLOCKED`.
   `PENDING` = spec exists, no log file yet. Verify its `Dependencies` are DONE
   by reading ONLY those tasks' `EXECUTION_LOG_*` files (result + gotchas only).
   If a dependency is not DONE, stop and say so.
3. At start, create `Tasks/EXECUTION_LOG_Txx.md` with `- Status: IN PROGRESS`
   in exactly this shape:
   ```markdown
   # Execution Log — Txx — <same title as the spec>
   - Task: Txx
   - Status: IN PROGRESS
   - Date: YYYY-MM-DD
   - Model: <your model id>

   ## Notes

   ## Session notes
   ```
4. Implement per the spec's Definition of Done, following the context-budget
   read rules in `Tasks/README.md` (contracts `docs/DATA_MODEL.md` /
   `docs/API.md` only when the task touches API/DB shapes).
5. Verify: targeted `pnpm vitest run <touched-spec>` during the loop, full gate
   once at the end — `./scripts/verify.sh` (install + lint + test + integrity).
   Fix failures; never lower the gate.
6. On green, set the log to `- Status: DONE` and append exactly one session
   line (≤200 chars):
   `- YYYY-MM-DD | Txx | <model id> | <what changed>; <key files>; gate <N> green.`
   Report the result and stop.

## Hard rules

- Update ONLY your own `Tasks/EXECUTION_LOG_Txx.md`. Never touch another
  task's spec or log.
- One task per run. Do not bundle the next task, do not freelance scope.
- Do NOT commit, push, amend, or merge unless the user explicitly asks —
  the orchestrator (`scripts/run-next-task.sh`) owns the exactly-one-commit
  step. Leave the tree with only the task's files changed.
- `BLOCKED` (needs a human) is set only with a note saying what is needed;
  rerun happens only on explicit request.
