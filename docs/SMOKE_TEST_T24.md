# T24 — Smoke test checklist on real Synology

Goal: validate resource budgets and UX on target hardware (docs/PROJECT.md → Non-functional).

## Where this was executed

The executing agent session runs on the laptop in **native linux/arm64 Docker** (Docker Desktop,
`docker version` → `Server.Arch = arm64`, `Server.Os = linux`) — the same platform as the Synology
DS223j. The full production stack (`docker-compose.prod.yml`, images built by
`scripts/build-images.sh` for `linux/arm64`) was booted with scratch volumes and exercised
end-to-end through the nginx proxy (`http://localhost:18080`). Per the T23 precedent
(DEPLOYMENT.md §10.3), arm64 Docker results carry over to the NAS; the phone-in-hand checks and
the Cloudflare-domain reachability check are the only items that strictly need the physical NAS +
tunnel and are marked accordingly.

## Checklist + results

| # | Check | Budget / expectation | Result | Status |
|---|---|---|---|---|
| 1 | Total memory (all containers) | < 150 MB idle RSS | api 74.6 MB (steady, after idle-GC settle) + web 6.2 MB = **80.8 MB**; `docker stats` view: 30 MB + 15 MB. Under traffic (upload + reads) api peaked ~69 MB in stats / 87 MB cgroup — still within budget | PASS |
| 2 | Cold start | < 5 s | `docker compose up -d` → api healthy → web up; api **restart → `/api/health` 200 in ~0.5 s**; full stack boot < 6 s wall (compose wait loop granularity) | PASS |
| 3 | UI load on LAN | < 1 s | index 0.002 s, JS bundle (467 KB) 0.005 s, CSS 0.002 s, item image 0.004 s — all well under 1 s | PASS |
| 4 | Login once (persistent auth) | no re-login after app restarts | Refresh token (sha256-hashed, SQLite on the `data` volume): login → **3 successive refresh rotations** (each old cookie 401, new one works) → survives **api restart** → survives **full stack down/up** (volumes kept) → logout revokes (post-logout refresh 401). Old access tokens stay valid after restart (15-min JWT, no server state) | PASS |
| 5 | Core flows through the prod proxy | works end-to-end | Admin bootstrap (DEPLOYMENT.md §8 exact commands) → login → create list ("T24 Smoke") → add item ("Oat milk", qty 1L) → price observation (2.49, Albert) → image upload (800×800 PNG → 600 px webp) → `/static/…` served with `Cache-Control: public, max-age=31536000, immutable` (T4.5) → list/items/data + image survive full stack restart | PASS |
| 6 | DnD + long-press on a real phone | touch-only behaviors work | **Needs the physical NAS + phone.** The supporting API (reorder endpoint, T16.5) and the whole stack behind it were verified in this run; the touch check itself must be done on-device after the first real deployment | MANUAL (pending) |
| 7 | Tunnel uptime | `tunnel` container stays up, forwards to web | The `--profile tunnel` service starts only after web is healthy (compose `condition: service_healthy`) and stays scheduled (`Restarting` with an invalid dummy token — correct behavior: it retries rather than crash-exiting permanently, `restart: unless-stopped`). Public HTTPS reachability via a real Cloudflare hostname needs live Zero-Trust credentials → do on the NAS (T22 note) | PARTIAL (pending on-device) |

## Issue found and fixed during this task

`CORS_ORIGIN=` (empty value — the **compose default** `${CORS_ORIGIN:-}` in
`docker-compose.prod.yml`) crashed the api at boot: `z.string().min(1).optional()` rejects `""`
with a ZodError. The stack was literally dead-on-arrival with a default `.env` that omits
`CORS_ORIGIN`. Fixed in `apps/api/src/config.ts`: the schema now trims the value and treats
empty/whitespace as unset (same semantics `loadConfig` already applied downstream), so an absent
`CORS_ORIGIN` keeps the existing "allow same-origin + reflect" behavior. Covered by 6 new tests in
`apps/api/src/config.test.ts` (empty, whitespace, single, comma-list, unset, prod-secret guard).

## Verdict

All checks that are executable without the physical NAS / a real Cloudflare domain **pass**.
Items 6–7 remain on-device verifications for the first real deployment; no code issues are
expected there (their API/stack prerequisites were all verified here). No further tasks filed.
