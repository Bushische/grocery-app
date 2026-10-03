# Deployment & Backup Runbook

Deploy the app from zero to the Synology DS223j (or any arm64 Docker host), keep it running,
back it up, and restore it. Written to be followed top-to-bottom by a reader who has never seen
the repo. Normative sources: docs/ARCHITECTURE.md (topology, backups), docs/PROJECT.md (budgets).
The backup + restore drill in §10 was executed for real on 2026-09-27 (see §10.3 for results).

## 1. Topology (what runs where)

```
Phone / browser ──HTTPS──▶ Cloudflare ──▶ cloudflared (tunnel, 64 MB) ──▶ web (nginx, :8080, 32 MB)
                                                                    ├── /          → SPA static files
                                                                    ├── /api/*     → api:3000 (prefix stripped)
                                                                    ├── /oauth/*   → api:3000 (Alice linking, path kept)
                                                                    └── /static/*  → api:3000 (item images)
api (node, :3000, 128 MB) ── in-process SQLite (WAL) ──▶ docker volume data     → /data/grocery.db
                                    └── item images (.webp) ──▶ docker volume uploads → /data/images
```

- No database container. SQLite runs inside the api container; its file lives on the `data`
  docker volume. Item images live on the `uploads` volume and are served by the api.
- All three containers sit on one compose bridge network. Only `cloudflared` egresses.
- Budget (docs/PROJECT.md): all containers together < 150 MB RSS. Measured: api ≈ 63 MB,
  web (nginx) ≈ 7 MB, tunnel ≈ 20–30 MB.

## 2. Prerequisites

| Where | What |
|---|---|
| NAS | DSM 7.2+ with **Container Manager** (provides `docker compose` v2); SSH enabled (Control Panel → Terminal & SNMP); ~250 MB disk for images + space for backups |
| Laptop | Docker Desktop or colima **with buildx**; this repository checked out; `pnpm install` done once (images build via Docker, not pnpm) |
| Cloudflare | A domain on Cloudflare + Zero Trust account (only needed for §7, the public HTTPS access) |

## 3. Build the images (laptop)

Images are built locally for `linux/arm64` — no CI, no registry. On an Apple Silicon laptop this
is native; on Intel it goes through QEMU emulation (slower, same result).

```bash
pnpm test && pnpm lint            # never ship a red tree
./scripts/build-images.sh         # → grocery-api:latest + grocery-web:latest (linux/arm64)
```

For rollback-capable releases, tag by date instead of (or in addition to) `latest`:

```bash
API_TAG=grocery-api:2026-09-27 WEB_TAG=grocery-web:2026-09-27 ./scripts/build-images.sh
```

## 4. Transfer to the NAS

```bash
NAS_HOST=alex@nas ./scripts/deploy.sh
```

What the script does (so you can do it by hand if you prefer):

```bash
docker save grocery-api:latest | ssh "$NAS_HOST" docker load
docker save grocery-web:latest | ssh "$NAS_HOST" docker load
scp docker-compose.prod.yml "$NAS_HOST":grocery/docker-compose.prod.yml
```

The transfer is resumable by simply re-running it; `docker load` replaces the image wholesale.

## 5. Configure `.env` (secrets) on the NAS

```bash
ssh alex@nas
mkdir -p ~/grocery && cd ~/grocery            # deploy.sh copies the compose file here
cp /volume1/docker/grocery/.env.prod.example .env  # or fetch it from the repo first
```

Edit `.env` (it is gitignored; keep it off the repo):

| Variable | How to set | Notes |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 48` (run on the laptop, paste the value) | **Required.** The api refuses to boot in production without a non-default value. Rotating it later is safe: existing refresh tokens are opaque server-side rows, so clients silently re-login via `/api/auth/refresh`. |
| `CORS_ORIGIN` | the public origin, e.g. `https://grocery.example.com` | Must exactly match the origin the app is served from (§7). Comma-separated list allowed. Wrong value = the SPA loads but every API call fails CORS. |
| `TELEGRAM_BOT_TOKEN` | the bot token from BotFather (`@BotFather` → `/newbot`) | **Required.** The api refuses to boot in production without it (same fail-fast as `JWT_SECRET`/`CORS_ORIGIN`). It validates Telegram Mini App `initData` signatures (`POST /auth/telegram/session|link`): without the real value, Telegram auto-login cannot work. After setting it, point the bot's Menu Button URL at `https://grocery.<your-domain>/` — no new infra, the same web build is served inside Telegram. |
| `DATABASE_PATH` | `/data/grocery.db` (default) | Fixed by the compose file; don't change. |
| `UPLOADS_PATH` | `/data/images` (default) | Fixed by the compose file; don't change. |
| `WEB_PORT` | `8080` | LAN port nginx listens on (host side). |
| `LOG_LEVEL` | `info` | Set `debug` while troubleshooting. |
| `TUNNEL_TOKEN` | from the Cloudflare dashboard (§7) | Required only for the `tunnel` profile. |

`chmod 600 .env`.

## 6. First boot

```bash
cd ~/grocery
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml --env-file .env ps     # api + web healthy in ~30 s
curl -s http://localhost:8080/api/health        # → {"status":"ok"}
curl -sI http://localhost:8080/ | head -1       # → 200 (SPA shell)
docker stats --no-stream                        # api ~63 MB, web ~7 MB — well under budget
```

What happens on first boot: the api creates `/data/grocery.db` on the `data` volume and applies
the Drizzle migrations automatically (idempotent). No manual migration step, ever.

## 7. Cloudflare Tunnel (public HTTPS, no open ports)

One-time, in the Cloudflare Zero Trust dashboard (Networks → Tunnels):

1. Create a tunnel; copy its **token** into `.env` as `TUNNEL_TOKEN`.
2. Add a **public hostname**: `https://grocery.<your-domain>` → service `HTTP` → `web:8080`.
   (The dashboard creates the DNS route `<tunnel-id>.cfargotunnel.com` for you.)
3. Make sure `CORS_ORIGIN` in `.env` is exactly `https://grocery.<your-domain>`.

Start the tunnel (its compose service is behind the `tunnel` profile):

```bash
cd ~/grocery
docker compose -f docker-compose.prod.yml --profile tunnel --env-file .env up -d
```

Verify from a phone **on mobile data** (not LAN): `https://grocery.<your-domain>/api/health` →
`{"status":"ok"}`, then log in in the app. If the app loads but login hangs, re-check `CORS_ORIGIN`.

## 8. Create the first admin user

A fresh deployment has an **empty users table** and no open registration (by design — the API has
no register endpoint; `POST /api/users` is admin-only). Bootstrap the first admin:

**1. On the laptop**, hash the password with the repo's bcrypt (never paste a plain password):

```bash
cd <repo>
node -e "console.log(require('./apps/api/node_modules/bcryptjs').hashSync(process.argv[1], 10))" 'YOUR-PASSWORD'
# → $2b$10$...
```

**2. On the NAS**, insert the admin row (safe while the api runs; the busy timeout guards the
single-writer lock):

```bash
cd ~/grocery
HASH='$2b$10$…'      # single-quoted, so $ signs stay literal
docker compose -f docker-compose.prod.yml --env-file .env exec -T api node -e '
  const db = require("better-sqlite3")("/data/grocery.db", { timeout: 5000 });
  const [email, hash] = process.argv.slice(1);
  db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(require("node:crypto").randomBytes(16).toString("hex"), email, hash, "admin");
  console.log("admin created:", email);
  db.close();
' "alex@example.com" "$HASH"
```

**3. Log in** at `https://grocery.<your-domain>` with that email + password. Create everyone else
in the app as admin (`POST /api/users`), and API tokens for agents under Settings
(`POST /api/api-tokens` — the `glc_…` value is shown once).

## 9. Volume layout (what to back up)

```bash
docker volume ls           # grocery_data, grocery_uploads  (prefix = compose project = folder name)
docker volume inspect grocery_data
```

| Volume | Container path | Contents |
|---|---|---|
| `grocery_data` | `/data` | `grocery.db` — the entire app state (users, lists, items, prices). While the api runs, also `grocery.db-wal` / `-shm` (WAL side files — **never** copy or delete them while the api is running; they are not part of a snapshot). |
| `grocery_uploads` | `/data/images` | `<itemId>-<sha256>.webp` — content-addressed item images (a re-upload produces a new file, old ones are garbage-collected by the api). |

Docker volumes live under `/volume1/@docker/volumes/...` on the NAS. Don't operate on those host
paths directly — every command below goes through containers (`--volumes-from`), so it works
regardless of where DSM put the volumes.

## 10. Backups + restore drill (tested)

### 10.1 The backup script (daily DB + weekly images)

Create `/volume1/docker/grocery/backup.sh` on the NAS (adjust `APP_DIR` to where the compose file
lives). Schedule it under **DSM Control Panel → Task Scheduler → Create → Scheduled Task →
User-defined script**, user `root`, daily 03:00. Run it once by hand first.

```sh
#!/bin/sh
# Grocery backup: daily consistent SQLite snapshot + weekly uploads tar.
# The .backup API takes a crash-consistent snapshot while the api keeps running (WAL-safe).
set -eu
APP_DIR="/volume1/docker/grocery"
BACKUP_DIR="/volume1/docker/grocery-backups"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml --env-file $APP_DIR/.env"

mkdir -p "$BACKUP_DIR"
API_CID="$($COMPOSE ps -q api)"

# Daily: consistent DB snapshot into a single portable file.
docker run --rm --volumes-from "$API_CID" -v "$BACKUP_DIR":/backups \
  grocery-api:latest node -e '
    const db = require("better-sqlite3")("/data/grocery.db", { readonly: true, timeout: 5000 });
    const dest = "/backups/grocery-" + new Date().toISOString().slice(0, 10) + ".db";
    db.backup(dest).then(() => db.close())
      .then(() => console.log("db backup ok: " + dest))
      .catch((e) => { console.error("db backup failed:", e.message); process.exit(1); });'

# Weekly (Sundays): item images as one tarball.
if [ "$(date +%u)" = "7" ]; then
  docker run --rm --volumes-from "$API_CID" -v "$BACKUP_DIR":/backups \
    grocery-api:latest sh -c 'tar czf "/backups/uploads-$(date +%F).tar.gz" -C /data/images .'
fi

# Retention: 14 daily DB snapshots, 8 weekly image tars.
find "$BACKUP_DIR" -name 'grocery-*.db'     -mtime +14 -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +56 -delete
```

Notes:
- The one-off container reuses the **running api container's volumes** (`--volumes-from`) and the
  api **image** (which carries better-sqlite3) — no extra packages, no volume-path coupling.
- Each daily file is a self-contained DB (~KB–MB); verify any snapshot on the spot:

```bash
docker run --rm -v /volume1/docker/grocery-backups:/backups grocery-api:latest node -e '
  const db = require("better-sqlite3")("/backups/grocery-2026-09-27.db", { readonly: true });
  console.log(db.pragma("integrity_check", { simple: true }));'   # → ok
```

- **Keep a copy off the NAS** (USB disk via Hyper Backup/rsync of
  `/volume1/docker/grocery-backups`): the NAS disk is the single failure domain otherwise.
- Run a backup right before every upgrade (§11) — it makes rollback trivial.

### 10.2 Restore procedure

**Restore the DB** (from `grocery-YYYY-MM-DD.db`):

```bash
cd /volume1/docker/grocery
BACKUP_DIR=/volume1/docker/grocery-backups
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
API_CID="$($COMPOSE ps -q api)"

$COMPOSE stop api                     # no writer while swapping the file

# Replace the live DB with the snapshot. ALWAYS delete the stale WAL/SHM files first:
# replaying an old snapshot under a newer -wal file would corrupt/diverge it.
docker run --rm --volumes-from "$API_CID" -v "$BACKUP_DIR":/backups:ro -u app \
  grocery-api:latest sh -c '
    rm -f /data/grocery.db /data/grocery.db-wal /data/grocery.db-shm
    cp /backups/grocery-2026-09-27.db /data/grocery.db'

$COMPOSE up -d                        # api reboots onto the snapshot; migrations are idempotent
```

`-u app` runs the copy as the image's unprivileged runtime user (uid 100), so the restored file
lands with correct ownership. Then verify:

```bash
docker run --rm --volumes-from "$API_CID" grocery-api:latest node -e '
  const db = require("better-sqlite3")("/data/grocery.db", { readonly: true });
  console.log(db.pragma("integrity_check", { simple: true }));'    # → ok
curl -s http://localhost:8080/api/health                              # → {"status":"ok"}
```

…and app-level: log in (sessions issued after the snapshot are gone — expected, users re-login)
and check a list renders its items.

**Restore the images** (from `uploads-YYYY-MM-DD.tar.gz`) — no restart needed, files are served
per request:

```bash
docker run --rm --volumes-from "$API_CID" -v "$BACKUP_DIR":/backups:ro -u app \
  grocery-api:latest sh -c '
    find /data/images -name "*.webp" -delete
    tar xzf /backups/uploads-2026-09-21.tar.gz -C /data/images'
```

Verify a previously-known image URL loads: `curl -sI http://localhost:8080/static/<file>.webp`.

### 10.3 Drill results (executed 2026-09-27, linux/arm64 Docker — same platform as the NAS)

The exact commands of §10.1/§10.2 were run against the real `grocery-api:latest` image on a
scratch volume (api running, real HTTP traffic through it):

1. Fresh volume → api booted → `/health` 200 → first admin bootstrapped (§8 command) → login OK →
   list + 2 items + price observation created via the API → image uploaded, served from
   `/static/…` with the immutable cache header.
2. `db.backup()` snapshot taken **while the api was serving** → `integrity_check` = ok.
3. Post-backup mutation (an extra item) → DB restore per §10.2 → api restarted → login works,
   pre-backup items intact, post-backup item gone.
4. `uploads-*.tar.gz` restored after deleting the image file → `/static/<file>` → 200 again.

Result: **pass**.

## 11. Upgrades

```bash
# 1. Snapshot first (cheap, makes rollback trivial):
ssh alex@nas 'sh /volume1/docker/grocery/backup.sh'

# 2. Rebuild + transfer from the laptop:
./scripts/build-images.sh
NAS_HOST=alex@nas ./scripts/deploy.sh

# 3. Recreate changed containers on the NAS:
ssh alex@nas 'cd ~/grocery && docker compose -f docker-compose.prod.yml --env-file .env up -d'
```

- DB migrations run automatically at api boot (idempotent). If a new api fails after upgrading,
  restore the pre-upgrade snapshot (§10.2) and re-transfer the previous image.
- **Rollback to a known build**: keep date-tagged images (§2). On the NAS set
  `API_IMAGE=grocery-api:2026-09-27` / `WEB_IMAGE=grocery-web:2026-09-27` in `.env`
  (docker-compose.prod.yml reads them) and `up -d` again.
- Reclaim disk: `docker image prune -f` on the NAS after a successful upgrade.

## 12. Troubleshooting

| Symptom | Check |
|---|---|
| App loads, API calls fail in the browser but `curl http://localhost:8080/api/health` works on the NAS | `CORS_ORIGIN` doesn't match the public origin (§5/§7). |
| api restart-loops | `docker logs grocery-api-1` — usually a missing `JWT_SECRET`, `CORS_ORIGIN`, or `TELEGRAM_BOT_TOKEN` (all three are required in production) or a full disk. |
| Login suddenly fails for everyone | `JWT_SECRET` changed is fine (silent refresh); a **DB restore** logs out sessions issued after the snapshot — users re-login. |
| `grocery.db-wal` grows large | Normal while running; it checkpoints automatically. Only relevant: always `rm` WAL/SHM when swapping the DB file (§10.2). |
| Slow API on LAN | `docker stats --no-stream` — check the 128 MB api limit isn't being hit (OOM thrash). |
| Need deeper logs | Set `LOG_LEVEL=debug` in `.env`, `up -d`, then `docker logs -f grocery-api-1` (pino JSON on stdout). |
