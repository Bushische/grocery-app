# T51 — Alice webhook skeleton: protocol + auth + linking flow
- **Goal:** `POST /api/alice/webhook` that speaks protocol 1.0: verifies the caller,
  resolves the linked user, gates private access behind linking, replays saved requests.
- **Inputs:** T50 (tokens to validate), docs/ALICE_PLAN.md (§1–§2), official `request` /
  `response` / `auth/make-skill` docs; captured console-simulator payloads as fixtures.
- **Outputs:** `apps/api/src/alice/`: `protocol.ts` (zod schemas for request/response),
  `webhook.ts` (route: `skill_id` check, dispatch), `requireAlice` token→user resolution
  (`Authorization` header or `session.user.access_token`, same `request.user` shape as
  `requireAuth`), router with welcome/help/fallback; `start_account_linking` answer
  (only when `meta.interfaces.account_linking` exists, never together with `response`);
  `account_linking_complete_event` handling with pending-request replay from
  `session_state`; single-list binding — `alice_links(userId PK → listId)` table +
  migration, `links.ts` get/set (auto-bind when exactly one accessible list, else ask
  once with the answer carried via `session_state`; rebind when the bound list is
  gone); one-line registration in `app.ts`.
- **Definition of Done:** unlinked private intent → link card only; surfaces without
  `account_linking` → graceful message (never the card); linked request → user resolved
  and existing list guards apply; complete-event answers the saved request without
  repetition; invalid token → link card again; first linked turn binds one list
  (auto or ask-once; every request answered, never silent); full gate green.
- **Dependencies:** T50.
