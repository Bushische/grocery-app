# Redeploy a new version to Synology (update flow)

Update an already-installed grocery stack on a Synology NAS (DS223j or similar) with a new
version built on your laptop. For the very first installation (empty NAS, first admin,
tunnel creation), read `docs/DEPLOYMENT.md` + `docs/DEPLOYMENT-SYNLOGY.md` instead —
this file assumes the stack already runs on the NAS.

How it works, in one paragraph: there is no registry and no CI. You build two production
images on the laptop (`grocery-api`, `grocery-web`, `linux/arm64`), pipe them to the NAS
over SSH (`docker save | ssh … docker load`), copy the compose file, and restart the stack
there. The database and uploaded images live in Docker volumes on the NAS, so restarting
containers never deletes your data. New database migrations (e.g. `apps/api/drizzle/000N_*`)
apply automatically at api boot — which is exactly why you back up first.

Conventions used below: `user@nas` = your NAS SSH target (e.g. `admin@192.168.1.10`);
on the NAS, Docker lives at `/usr/local/bin/docker` (not on the default SSH `PATH`, so
every command below spells it out); the app directory on the NAS is `~/grocery`;
the public site is `https://grocery.buyontheway.xyz`.

## Prerequisites

- [ ] Laptop: this repository checked out, `pnpm install` done once, Docker Desktop (or
      colima) running with `buildx` available (`docker buildx version` prints a version).
- [ ] NAS: SSH enabled (DSM Control Panel → Terminal & SNMP → Enable SSH service),
      Container Manager installed, ~1 GB free disk (two images ≈ 360 MB + backup space).
- [ ] NAS: the stack already running from `~/grocery/docker-compose.prod.yml` with a
      `~/grocery/.env` file (if not — stop here and do the first install per
      `docs/DEPLOYMENT-SYNLOGY.md`).
- [ ] You know which git branch to deploy (e.g. `alice-integration`). All commands below
      run from the repository root on the laptop unless marked "on NAS".

## Step 0 — Laptop: clean tree on the right branch

```bash
git branch --show-current        # must print the branch you intend to deploy
git status -sb                   # must print nothing (clean tree). Commit or stash first.
git pull --ff-only               # make sure you are not behind origin (optional but safe)
```

Why: the images are built from your working tree. Uncommitted edits silently end up on
the NAS otherwise.

## Step 1 — Laptop: verify (never ship a red tree)

```bash
./scripts/verify.sh
```

This runs `pnpm install`, `pnpm lint`, the full test suite, and the docs integrity check.
Proceed only on `verify: ALL GREEN`. (Note: tests do not typecheck — the Docker build in
Step 2 runs `tsc`, which has caught real errors before. A green Step 1 does not guarantee
a green Step 2.)

## Step 2 — Laptop: build the arm64 images

```bash
./scripts/build-images.sh
docker images --format "{{.Repository}}:{{.Tag}} {{.Size}}" | grep grocery
```

Expected: `grocery-api:latest` (~300 MB) and `grocery-web:latest` (~60 MB), both for
`linux/arm64`. On Apple Silicon this is native; on Intel it emulates via QEMU (slower,
same result). If the build fails, read the error — it is almost always a TypeScript
error (`tsc`) in new code; fix it, commit, and rerun this step.

## Step 3 — NAS: back up the live database (do not skip)

Migrations run automatically on boot and cannot be un-applied. This snapshot is your way
back. Run on the NAS (SQLite `.backup` is WAL-safe while the api keeps running):

```bash
ssh user@nas
cd ~/grocery
mkdir -p ~/grocery-backups
API_CID=$(/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env ps -q api)
/usr/local/bin/docker run --rm --volumes-from "$API_CID" -v ~/grocery-backups:/backups \
  grocery-api:latest node -e '
    const db = require("better-sqlite3")("/data/grocery.db", { readonly: true, timeout: 5000 });
    const dest = "/backups/grocery-" + new Date().toISOString().slice(0, 10) + ".db";
    db.backup(dest).then(() => db.close()).then(() => console.log("db backup ok: " + dest));'
ls -la ~/grocery-backups   # confirm today's file exists and is NOT empty (several MB)
exit
```

## Step 4 — NAS: check/update `~/grocery/.env`

Open `~/grocery/.env` on the NAS (`nano ~/grocery/.env` over SSH) and make sure every
required value is present. Compare against `.env.prod.example` in the repo — if the
example gained new variables since your last deploy, add them now.

```bash
ssh user@nas
grep -v '^#' ~/grocery/.env | grep -v '^$'   # shows active (non-comment) lines; compare with the repo example
```

Values that must be real (not placeholders) in production:

| Variable | Meaning | Where the real value comes from |
|---|---|---|
| `JWT_SECRET` | Signs login sessions | Long random string, generated once, never changes |
| `CORS_ORIGIN` | Browser origin allowed to call the API | `https://grocery.buyontheway.xyz` |
| `OAUTH_CLIENT_ID` | Alice linking client id | `alice` (must match Yandex console «Идентификатор приложения») |
| `OAUTH_CLIENT_SECRET` | Alice linking secret | `openssl rand -base64 32` output; must EXACTLY match Yandex console «Секрет приложения» |
| `ALICE_SKILL_ID` | Our skill id | dialogs.yandex.ru → skill → «Общие сведения» |
| `TELEGRAM_BOT_TOKEN` | Telegram Mini App login | BotFather (`@BotFather` → `/newbot`) → paste the token. The api validates Mini App `initData` signatures against it (`POST /auth/telegram/session` for passwordless login, `/link` for the one-time email+password binding). After the stack is up, set the bot's Menu Button URL to `https://grocery.buyontheway.xyz/` (the same web build runs inside Telegram; no new infra). |
| `TELEGRAM_AUTH_MAX_AGE_SECONDS` | Mini App login freshness | `86400` (default = 24 h). Optional. |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram chat commands | `openssl rand -hex 32` output (Telegram allows only `A-Z a-z 0-9 _ -`, 1–256 chars — NOT base64: `+ / =` are rejected with "secret token contains illegal characters"). Telegram sends it as `X-Telegram-Bot-Api-Secret-Token`; the same value goes into the `setWebhook` call (Step 8b). |
| `TELEGRAM_MINI_APP_URL` | Open-app button in chat replies | `https://grocery.buyontheway.xyz/` (public URL of this same web build). |
| `EXTRACTION_BACKEND` | Chat action extraction (T66) | `deterministic` (default — regex + Alice NLU, zero external calls) or `jev` (unstructured messages judged by TypeSafe JEV; then `OPENROUTER_API_KEY` below is required). |
| `OPENROUTER_API_KEY` | JEV via OpenRouter | OpenRouter dashboard → API keys. Required iff `EXTRACTION_BACKEND=jev` (fail-fast at boot, same pattern as the bot token). Never logged. |
| `JEV_MODEL` | Pinned JEV release | `typesafe/jev-1.13` (pinned, not the `latest` alias, so tuned confidence thresholds stay stable). |
| `JEV_TIMEOUT_MS` | JEV verdict timeout | `5000` (default) — slow verdicts degrade to the clarify reply. |
| `JEV_CONFIDENCE_THRESHOLD` | JEV act-vs-clarify threshold | `0.6` (default, 0–1) — below it the bot clarifies instead of acting. |
| `LOG_LEVEL` | Api log verbosity | `info` (default). Set `debug` while troubleshooting. |
| `TUNNEL_TOKEN` | Cloudflare connector token | Cloudflare Zero Trust → Networks → Tunnels → Install connector |
| `WEB_PORT` | Host port for the web container | `8080` (must match the tunnel's public-hostname target `web:8080`) |

Boot behavior if something is wrong: empty/unset `JWT_SECRET`, `CORS_ORIGIN`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, or `TELEGRAM_MINI_APP_URL`
→ the api **refuses to boot** (by design — check `logs api`, Step 6).
`EXTRACTION_BACKEND=jev` without `OPENROUTER_API_KEY` → same fail-fast.
Missing Alice trio → the stack boots with dev defaults but **account
linking will not work**.

## Step 5 — Laptop: transfer images + compose file to the NAS

```bash
./scripts/deploy.sh user@nas
```

What it does: `docker save grocery-api:latest | ssh user@nas /usr/local/bin/docker load`
(same for web), then `mkdir -p ~/grocery` on the NAS and `scp` the compose file there.
DSM notes (already handled inside the script, listed here so the output makes sense):
absolute `/usr/local/bin/docker` path (DSM's non-interactive SSH `PATH` lacks it) and
`scp -O` (DSM 7 sshd usually has the sftp subsystem disabled). Takes a few minutes on a
home uplink (≈ 360 MB).

## Step 6 — NAS: restart the stack and verify boot

```bash
ssh user@nas
cd ~/grocery
/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env up -d
/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env ps
```

Expected: three containers `Up (healthy)` — `api`, `web`, and `tunnel` (tunnel only if
started with `--profile tunnel`; see Step 7). Then read the api boot log:

```bash
/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env logs --tail=40 api
```

Healthy signs: `/health` 200, `migrations applied` including the newest
`apps/api/drizzle/000N_*` files present in the repo, no `CORS_ORIGIN`/`JWT_SECRET`
validation errors, no exception stack traces. If the api container restarts in a loop,
the log tail tells you why — fix the `.env` value it complains about and `up -d` again.

## Step 7 — NAS: make sure the tunnel runs (public HTTPS)

```bash
/usr/local/bin/docker compose -f docker-compose.prod.yml --profile tunnel --env-file .env up -d
/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env ps tunnel
/usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env logs --tail=15 tunnel
```

Healthy signs: `Registered tunnel connection` lines, no `ERR` auth failures (those mean a
wrong `TUNNEL_TOKEN`). In the Cloudflare dashboard the tunnel must route the public
hostname `grocery.buyontheway.xyz` → HTTP → `web:8080`.

## Step 8 — Smoke tests (from the laptop, through the public URL)

Run in order; stop at the first failure and diagnose before continuing.

```bash
# 1. API is up behind the tunnel:
curl https://grocery.buyontheway.xyz/api/health
# → {"status":"ok"}

# 2. Yandex ownership file (site root proof):
curl -s https://grocery.buyontheway.xyz/yandex_b615b40f4c82d15b.html
# → must print: <body>Verification: b615b40f4c82d15b</body>  (HTTP 200, exact content)

# 3. OAuth consent page renders (proves the nginx /oauth/ → api proxy):
curl -s "https://grocery.buyontheway.xyz/oauth/authorize?response_type=code&client_id=alice&redirect_uri=https://social.yandex.net/broker/redirect&scope=alice&state=test" | head -c 300
# → must start with <!DOCTYPE html> and contain name="email".
# If you get the React app shell instead, the deployed web image predates the /oauth/ proxy fix.

# 4. Alice webhook is live (must REJECT a wrong skill id — rejection proves it answers):
curl -s -X POST https://grocery.buyontheway.xyz/api/alice/webhook \
  -H 'Content-Type: application/json' \
  -d '{"meta":{"locale":"ru-RU","timezone":"Europe/Moscow","interfaces":{}},"request":{"type":"SimpleUtterance","command":"помощь","original_utterance":"помощь","nlu":{"tokens":["помощь"],"entities":[]}},"session":{"message_id":0,"session_id":"smoke","skill_id":"wrong-id","new":true},"version":"1.0"}'
# → an error/4xx response (graceful rejection), NOT a timeout and NOT an nginx HTML page.

# 5. The app itself: open https://grocery.buyontheway.xyz in a browser, log in,
#    add an item, buy it (it must jump to the TOP of the bought section — T48),
#    un-buy it (back to the BOTTOM of to-buy). Upload a photo to one item.
```

If check 2 fails right after deploy: purge the Cloudflare edge cache for that URL (or
retry with `curl -H 'Cache-Control: no-cache'`) — stale edge cache is the usual suspect,
not the deploy. If check 3 returns the SPA: you transferred an old web image — rebuild
(Step 2) and re-transfer (Step 5).

## Step 8b — Telegram Bot API webhook (chat commands, T62–T64)

One-time per bot (the URL never changes, so no need to repeat on later deploys
unless the secret rotates). On the laptop:

```bash
BOT_TOKEN='<paste>' ; WEBHOOK_SECRET='<same-as-TELEGRAM_WEBHOOK_SECRET-on-NAS>'
# Secret must be 1-256 chars of A-Z a-z 0-9 _ - only (generate: openssl rand -hex 32).
# Base64 (+ / =) is rejected with "secret token contains illegal characters".
curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://grocery.buyontheway.xyz/api/telegram/bot-webhook" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
# → {"ok":true,...}
```

Then in BotFather: `/setprivacy` → pick the bot → **Enable** (privacy ON: the bot
gets `/commands`, `@mentions`, and `/command`-replies with the quoted text — plain
group chatter never reaches it, which is the point), then **re-add the bot to every
group** (the flip does not apply in place). Optional: `/setcommands` with `buy`,
`list`, `bought`, `unbuy`, `lists`, `use`, `help` for input autocomplete
(`callback_query` taps need `["message","callback_query"]` in the `setWebhook`
above, otherwise the inline list buttons arrive nowhere).

Verify: message the bot `buy apples` in a private chat → it replies and the item
appears in the list; `/buy milk, bread` adds both; reply `/buy` to a pasted
3-line list adds all three; an unlinked sender gets the link prompt instead. In a
group, plain `buy apples` is silence (privacy ON: nothing delivered — check api
logs only when a `/command` or `@mention` misbehaves).

## Step 9 — After a successful deploy

- [ ] If this version changes anything Yandex-facing (OAuth, webhook, dialog), re-run the
      simulator link flow per `docs/ALICE_CONSOLE_SETUP.md` §3 before touching the
      published skill settings.
- [ ] Confirm the scheduled NAS backup still runs (DSM Task Scheduler → last-run time).
- [ ] Push any leftover local commits (`git status -sb` clean, `git push`).

## Rollback

- **Data only** (bad migration, corrupt rows): stop the stack, copy the newest
  `~/grocery-backups/grocery-YYYY-MM-DD.db` back over the `data` volume, start again.
  Exact restore drill: `docs/DEPLOYMENT.md` §10.
- **Code** (new version misbehaves): `docker load` overwrote the `:latest` tags, so the
  previous images are gone from the NAS — check out the previous git commit/branch on
  the laptop, rebuild (Step 2), re-transfer (Step 5), reboot (Step 6).

## Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| `deploy.sh`: `image … not found locally` | Step 2 not run (or failed) → build first |
| `ssh`: `connection refused / timeout` | NAS SSH off or wrong host/user; DSM Control Panel → Terminal & SNMP |
| `scp`: `subsystem request failed` | Old script version — current `deploy.sh` uses `scp -O`; `git pull` the repo |
| api container restart-loops | Read `logs api` tail: usually `JWT_SECRET`/`CORS_ORIGIN`/`TELEGRAM_BOT_TOKEN` empty → fix `.env`, `up -d` again |
| `curl /api/health` → 000/timeout | Tunnel down (`ps tunnel`, tunnel logs) or Cloudflare route missing → Step 7 |
| Consent page returns the SPA | Old web image on NAS → rebuild + re-transfer (Step 2 → 5 → 6) |
| Yandex link button loops forever | `OAUTH_CLIENT_SECRET` on NAS ≠ console value, or `ALICE_SKILL_ID` wrong → Step 4, then Step 6 not needed (env-only change → just `up -d` again) |
| Skill says «не отвечает» for everything | Webhook unreachable or non-1.0 response → api logs during a simulator test |
