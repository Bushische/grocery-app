#!/usr/bin/env bash
# Orchestrator: spawn a fresh opencode agent per task, verify, commit.
# Usage:
#   ./scripts/run-next-task.sh          # next PENDING task, one shot
#   ./scripts/run-next-task.sh T8       # (re)execute a specific task
#   ./scripts/run-next-task.sh --loop   # loop until failure or all tasks DONE
#   OPENCODE_MODEL=z-ai/glm-5.3-flash ./scripts/run-next-task.sh   # default model
set -euo pipefail
cd "$(dirname "$0")/.."

LOG="docs/EXECUTION_LOG.md"
PROMPT_DOC="docs/EXECUTION_PROMPT.md"
MODEL="${OPENCODE_MODEL:-z-ai/glm-5.3-flash}"

get_next_task() {
  awk -F'|' '/^\| T[0-9]/ && /\| PENDING \|/ { gsub(/^ +| +$/, "", $2); print $2; exit }' "$LOG"
}

get_title() {
  awk -F'|' -v t="| $1 " 'index($0, t) == 1 { gsub(/^ +| +$/, "", $3); print $3; exit }' "$LOG"
}

# set_status <task> <status> [stamp_date]
set_status() {
  local tmp
  tmp=$(mktemp)
  awk -F'|' -v t="| $1 " -v s="$2" -v stamp="${3:-}" -v today="$(date +%F)" '
    index($0, t) == 1 {
      $4 = " " s " "
      if (stamp == "date" && $5 !~ /[^ ]/) $5 = " " today " "
      OFS = "|"; $1 = $1
    }
    { print }' "$LOG" > "$tmp" && mv "$tmp" "$LOG"
}

append_note() { # <task> <text>
  printf -- '- %s | %s | %s | %s\n' "$(date +%F)" "$1" "$MODEL" "$2" >> "$LOG"
}

verify() {
  if [ ! -f package.json ]; then
    echo "[verify] no package.json yet — skipping lint/test"
    return 0
  fi
  if ! command -v pnpm > /dev/null; then
    echo "[verify] pnpm is required once package.json exists (corepack enable)"
    return 1
  fi
  pnpm install
  pnpm run --if-present lint
  pnpm run --if-present test
}

run_one() { # <task>
  local task="$1" title prompt
  title="$(get_title "$task")"
  echo "==> Task $task: $title"

  set_status "$task" "IN_PROGRESS"
  prompt=$(awk '/<!-- PROMPT-START -->/{f=1;next} /<!-- PROMPT-END -->/{f=0} f' "$PROMPT_DOC" |
    sed "s/{{TASK_ID}}/$task/g")

  if ! opencode run --auto -m "$MODEL" --title "grocery-list $task" "$prompt"; then
    append_note "$task" "agent session exited with an error — task left IN_PROGRESS"
    echo "[!] Agent failed for $task — inspect and rerun: ./scripts/run-next-task.sh $task"
    return 1
  fi

  echo "==> Verifying $task"
  if ! verify; then
    append_note "$task" "verification failed (lint/test) — changes left uncommitted for inspection"
    echo "[!] Verification FAILED for $task — changes left uncommitted for inspection."
    echo "    Fix and rerun:  ./scripts/run-next-task.sh $task"
    return 1
  fi

  set_status "$task" "DONE" "date"
  git add -A
  if git diff --cached --quiet; then
    append_note "$task" "agent produced no changes"
    echo "[!] Nothing to commit for $task."
  else
    git commit -m "feat($task): $title"
    append_note "$task" "completed and committed ($(git rev-parse --short HEAD))"
  fi
  echo "==> $task DONE"
}

ARG="${1:-}"
case "$ARG" in
  --loop)
    while :; do
      task="$(get_next_task)"
      [ -z "$task" ] && { echo "All tasks DONE."; exit 0; }
      run_one "$task" || exit $?
    done
    ;;
  "")
    task="$(get_next_task)"
    if [ -z "$task" ]; then echo "All tasks DONE."; exit 0; fi
    run_one "$task"
    ;;
  T[0-9]*)
    run_one "$ARG"
    ;;
  *)
    echo "Usage: $0 [--loop | Tn]  (e.g. $0 T8, $0 T16.5)"
    exit 1
    ;;
esac
