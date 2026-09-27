# Running the app locally in Docker (prod stack)

Step-by-step instruction for testing the real app (React web + Fastify api) in Docker on your
laptop, with a **local SQLite file you can inspect from the host**. This mirrors the T24 smoke
test setup.

> Do **not** use the dev `docker-compose.yml` for this — its `web` service is still the T2
> placeholder stub. The real app is the prod stack (`docker-compose.prod.yml`).

## 1. Prerequisites

- Docker Desktop running (arm64 — same platform the images are built for).
- `.env` in the repo root with at least:
  ```
  JWT_SECRET=<any long random string>
  ```
  (`CORS_ORIGIN` may be empty — the api treats empty as unset.)

## 2. Build the images

Build from the **repo root** — the Dockerfiles copy the whole monorepo (`packages/shared`,
`apps/web`), so the build context must be `.` while `-f` points into the app folder:

```bash
docker build -t grocery-api:latest -f apps/api/Dockerfile .
docker build -t grocery-web:latest -f apps/web/Dockerfile .
```

(`-t` = tag name; `-f` = Dockerfile path; `.` = build context — all `COPY` paths in the
Dockerfile resolve against this, not against the Dockerfile's own folder.)

## 3. Map a local SQLite file

SQLite is a single file plus `-wal`/`-shm` siblings — bind-mount the **directory**, never the
`.db` file itself.

```bash
mkdir -p local-data
cp /path/to/existing/grocery.db local-data/grocery.db   # or: touch local-data/grocery.db (api migrates at boot)
chmod -R 777 local-data                                  # container runs as uid 100 (app), needs write access
```

Create `docker-compose.override.yml` in the repo root (replace the named `data` volume with the
bind mount):

```yaml
services:
  api:
    volumes:
      - ./local-data:/data
      - uploads:/data/images
```

> ⚠️ Compose does **not** auto-merge `docker-compose.override.yml` when you pass `-f` explicitly —
> you must list it in the `up` command (step 4). If you forget, the api mounts the named volume
> and you get `SqliteError: unable to open database file` (SQLITE_CANTOPEN).

## 4. Start the stack

```bash
docker compose down                                                        # stop anything running first
docker compose -f docker-compose.prod.yml -f docker-compose.override.yml up -d
```

The tunnel service requires `TUNNEL_TOKEN`, but both compose files treat it as optional
(`${TUNNEL_TOKEN:-}`) and the service is behind `profiles: ['tunnel']` — it won't start here.
If you see `required variable TUNNEL_TOKEN is missing`, your compose files predate the fix;
run with `TUNNEL_TOKEN=dummy` or update the compose files.

Wait for the api healthcheck to pass:

```bash
docker compose -f docker-compose.prod.yml ps     # api should show (healthy)
```

## 5. Verify

```bash
# the bind mount is actually in effect (host path, not /var/lib/docker/volumes/...):
docker inspect grocery-list-api-1 \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'

# SQLite is readable and migrations ran:
sqlite3 local-data/grocery.db "SELECT count(*) FROM lists;"

# api directly:
curl -s http://localhost:8080/api/health
```

Open **http://localhost:8080** — real web app (nginx serves static files and proxies
`/api` + `/static`). Log in with the seeded admin (credentials from `apps/api/scripts/seed.ts`
or created via the bootstrap flow in `docs/DEPLOYMENT.md` §8).

Quick functional smoke:
- log in → lists/items load (silent refresh works across reloads)
- item details → upload an image → check `local-data/images/` got a `<id>-<hash>.webp` file
- `curl -sI http://localhost:8080/static/<that-file> | grep -i cache-control` → `max-age=31536000, immutable`

## 6. Permissions note for the NAS

`chmod -R 777` is fine for laptop testing. On the Synology, match the container uid instead:

```bash
chown -R 100:101 /volume1/docker/grocery/local-data
```

(uid 100 / gid 101 = the `app` user baked into the api image.)

## 7. Teardown

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.override.yml down
```

`local-data/` is your persistent db — keep it or copy it out. Rebuilding after code changes:
rerun step 2, then `up -d` (compose recreates containers when the image changes).