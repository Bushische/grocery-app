#!/usr/bin/env node
// Log integrity gate: docs/TASKS.md <-> docs/EXECUTION_LOG.md must agree.
// Catches the "commit message claims T25-T32 but only T25-T29 landed" class of drift.
// Exit 0 = consistent, exit 1 = problems (printed).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID_STATUSES = new Set(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]);

const read = (p) => readFileSync(join(root, p), "utf8");
const fail = (problems) => {
  for (const p of problems) console.error(`INTEGRITY: ${p}`);
  console.error(`INTEGRITY: ${problems.length} problem(s) found`);
  process.exit(1);
};
const taskId = (s) => s.match(/T\d+(\.\d+)?/)?.[0] ?? null;

// --- TASKS.md: "### Tn — title" headings
const tasksSpecs = [...read("docs/TASKS.md").matchAll(/^### (T\d+(?:\.\d+)?) —/gm)].map(
  (m) => m[1],
);

// --- EXECUTION_LOG.md: "| Tn | title | status | date | notes" rows
const problems = [];
const logRows = new Map(); // id -> { status, date, line }
for (const [i, line] of read("docs/EXECUTION_LOG.md").split("\n").entries()) {
  if (!/^\| T\d/.test(line)) continue;
  const cells = line.split("|").map((c) => c.trim());
  const id = taskId(cells[1]);
  const status = cells[3] ?? "";
  if (!id) {
    problems.push(`log line ${i + 1}: cannot parse task id from "${cells[1]}"`);
    continue;
  }
  if (logRows.has(id)) problems.push(`log: duplicate row for ${id}`);
  if (!VALID_STATUSES.has(status)) {
    problems.push(`log ${id}: unknown status "${status}"`);
  }
  if (status === "DONE" && !(cells[4] ?? "").match(/^\d{4}-\d{2}-\d{2}$/)) {
    problems.push(`log ${id}: DONE without a YYYY-MM-DD date`);
  }
  if (status === "PENDING" && /\S/.test(cells[5] ?? "")) {
    problems.push(`log ${id}: PENDING row carries notes (should be empty)`);
  }
  logRows.set(id, { status, date: cells[4] ?? "", line: i + 1 });
}

// --- cross-checks
const specIds = new Set(tasksSpecs);
const logIds = new Set(logRows.keys());
for (const id of tasksSpecs) {
  if (!logIds.has(id)) problems.push(`TASKS.md has spec for ${id} but no log row`);
}
for (const id of logIds) {
  if (!specIds.has(id))
    problems.push(`log has row for ${id} but TASKS.md has no "### ${id} —" spec`);
}

// --- exactly one IN_PROGRESS at a time (the orchestrator's invariant)
const inProgress = [...logRows].filter(([, r]) => r.status === "IN_PROGRESS");
if (inProgress.length > 1) {
  problems.push(`log: multiple IN_PROGRESS rows: ${inProgress.map(([id]) => id).join(", ")}`);
}

// --- ordering: log row order must match TASKS.md spec order (orchestrator picks the first PENDING row)
const specOrder = tasksSpecs.map((id, i) => [id, i]);
const logOrder = [...logRows.keys()];
for (const [a, b] of specOrder.slice(0, -1).map(([id], i) => [id, specOrder[i + 1][0]])) {
  if (
    logOrder.indexOf(a) > -1 &&
    logOrder.indexOf(b) > -1 &&
    logOrder.indexOf(a) > logOrder.indexOf(b)
  ) {
    problems.push(`ordering: log row ${a} comes after ${b} but TASKS.md lists ${a} first`);
  }
}

if (problems.length) fail(problems);
console.log(
  `INTEGRITY: ok — ${logRows.size} log rows, ${tasksSpecs.length} task specs, all consistent`,
);

// --- New model: Tasks/TASK_<ID>.md + Tasks/EXECUTION_LOG_<ID>.md (one file per task)
import { readdirSync, existsSync } from "node:fs";
const newProblems = [];
const newIds = new Set();
if (existsSync(join(root, "Tasks"))) {
  const files = readdirSync(join(root, "Tasks"));
  for (const f of files) {
    const m = f.match(/^TASK_(T\d+)\.md$/);
    if (!m) continue;
    const id = m[1];
    if (newIds.has(id)) newProblems.push(`Tasks: duplicate spec for ${id}`);
    newIds.add(id);
    const body = read(`Tasks/${f}`);
    if (!new RegExp(`^#\\s+${id}\\b`, "m").test(body)) {
      newProblems.push(`Tasks/${f}: first heading must be "# ${id} — <title>"`);
    }
    if (!/Definition of Done/.test(body)) {
      newProblems.push(`Tasks/${f}: missing Definition of Done`);
    }
  }
  let newInProgress = 0;
  for (const f of files) {
    const m = f.match(/^EXECUTION_LOG_(T\d+)\.md$/);
    if (!m) continue;
    const id = m[1];
    if (!newIds.has(id)) {
      newProblems.push(`Tasks/${f}: no matching TASK_${id}.md`);
      continue;
    }
    const body = read(`Tasks/${f}`);
    const st = (body.match(/^-\s*Status:\s*(\S+)/m) || [])[1] ?? "";
    if (!VALID_STATUSES.has(st)) {
      newProblems.push(`Tasks/${f}: unknown Status "${st}"`);
    }
    if (body.match(/^-\s*Task:\s*(\S+)/m)?.[1] !== id) {
      newProblems.push(`Tasks/${f}: "- Task:" must be "${id}"`);
    }
    if (st === "DONE" && !(body.match(/^-\s*Date:\s*(\S+)/m) || [])[1]?.match(/^\d{4}-\d{2}-\d{2}$/)) {
      newProblems.push(`Tasks/${f}: DONE without a YYYY-MM-DD Date`);
    }
    if (st === "IN_PROGRESS") newInProgress++;
  }
  if (newInProgress > 1) {
    newProblems.push(`Tasks: multiple IN_PROGRESS logs (${newInProgress})`);
  }
}

if (newProblems.length) fail(newProblems);
if (existsSync(join(root, "Tasks"))) {
  console.log(`INTEGRITY: ok — ${newIds.size} per-task spec(s) in Tasks/, all consistent`);
}
