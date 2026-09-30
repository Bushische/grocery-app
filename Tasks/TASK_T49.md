# T49 — OAuth provider: tables + token service (Alice account linking)
- **Goal:** Persisted OAuth 2.0 code-grant backend so Yandex can link an Alice user to our
  email user: single-use codes plus hashed access/refresh tokens with expiries.
- **Inputs:** docs/ALICE_PLAN.md (§2 token model), T3 (Drizzle schema/migrations),
  `apiTokenService.ts` (sha256-hash-only token practice to mirror).
- **Outputs:** `oauth_clients` (pre-seeded `alice` row: id + secret hash), `oauth_codes`
  (code hash → userId, 10-min TTL, single-use flag), `oauth_tokens` (token hash → userId,
  clientId, scope `alice`, access TTL 30 d, refresh TTL 1 y) + drizzle migration;
  `apps/api/src/oauth/oauthService.ts` (issue/validate/consume code, issue/rotate/validate
  access+refresh, all hashes, expiries enforced); unit tests.
- **Definition of Done:** code redeemable exactly once and only before expiry; expired/
  unknown/revoked tokens rejected; refresh rotation invalidates the old pair; secrets and
  plaintext tokens never persisted; full gate green. No routes yet.
- **Dependencies:** T3.
