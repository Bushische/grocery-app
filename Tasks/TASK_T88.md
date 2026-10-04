# T88 — Non-owners can leave a list; owner email is visible
- **Goal:** A non-owner member can leave a list they can't delete, and everyone sees who owns it.
- **Inputs:** `DELETE /lists/:id/members/:userId` (OWNER-only today — leaving impossible), `member-list.tsx` + `members-page.tsx`, `listMemberSchema` (already carries emails).
- **Outputs:** Self-removal allowed for any role on `DELETE …/members/:userId` when caller == userId (removing *others* stays OWNER-only; the last OWNER cannot leave — 409 with transfer-ownership hint); members UI shows the owner's email (badged Owner row) and a `Leave list` action for the signed-in non-owner (confirm inline, then navigate back to lists).
- **Definition of Done:** Inject tests pin self-leave per role, owner-kicks-member unchanged, non-owner-kicks-other still 403, last-owner-leave 409; component tests pin owner email display + leave-navigate; full gate green.
- **Dependencies:** T87.
