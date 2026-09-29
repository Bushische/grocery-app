# Tasks — per-task files (new model)

Old system (`docs/TASKS.md` + `docs/EXECUTION_LOG.md`, one giant file each) is a frozen
archive for T1–T46. All new work uses one small file per task here, so an agent session
reads ~2 KB instead of ~150 KB.

## Naming

- Spec: `Tasks/TASK_<ID>.md` — e.g. `TASK_T47.md`. `<ID>` is the task id verbatim
  (`T48`, `T49`, …; integers only for new tasks, no more `x.y` variants).
- Log: `Tasks/EXECUTION_LOG_<ID>.md` — e.g. `EXECUTION_LOG_T47.md`, created by the
  orchestrator when execution starts, never by hand for a new task.

## Lifecycle

- `PENDING` = spec file exists, no log file yet.
- `IN_PROGRESS` / `DONE` / `BLOCKED` = log file exists with a `- Status:` line.
- The orchestrator (`scripts/run-next-task.sh`) picks the first non-`DONE` task in
  version-sorted ID order, skipping `BLOCKED` (needs a human; rerun explicitly).
- The agent updates ONLY its own `EXECUTION_LOG_<ID>.md` (status + one session line).

## Adding a new task

1. Next ID = max existing + 1 (`ls Tasks/TASK_*.md`).
2. Copy this format (concise but implementable — Goal, Inputs, Outputs, Definition of
   Done, Dependencies; 15–25 lines):
   ```markdown
   # T48 — Short title
   - **Goal:** one sentence: what changes for the user.
   - **Inputs:** files/specs/contracts the task builds on.
   - **Outputs:** files/endpoints/schemas the task creates.
   - **Definition of Done:** observable checks + tests that pin them.
   - **Dependencies:** task IDs that must be DONE first.
   ```
3. No log file — its absence IS the `PENDING` state.
4. Run `node scripts/check-log-integrity.mjs` to validate.

## Agent read rules (context budget)

- Always: `docs/CONTEXT.md` + your own `Tasks/TASK_<ID>.md`.
- `docs/DATA_MODEL.md` / `docs/API.md` ONLY if the task touches API shapes, DB schema,
  or endpoint behavior.
- Another task's `EXECUTION_LOG_<ID>.md` ONLY to check a dependency's execution result
  (did it land? what files? what gotchas?) — never the whole directory.
- NEVER read `docs/TASKS.md` / `docs/EXECUTION_LOG.md` (archive) or other tasks' specs.
