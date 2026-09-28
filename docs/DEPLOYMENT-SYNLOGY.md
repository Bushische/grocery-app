# Synology DS223j Deployment — from zero (including Cloudflare tunnel + free domain)

Companion to `docs/DEPLOYMENT.md` (build/transfer, backups, restore). This guide covers
everything from a factory DS223j to the app on your phone: free domain, Cloudflare tunnel,
Container Manager, first boot, first admin.

> **About "DNS from Synology" (`yourname.synology.me`):** Synology DDNS only creates an
> **A record** (yourname.synology.me → your IP) and cannot hold the CNAME record a
> Cloudflare tunnel needs (`<tunnel-id>.cfargotunnel.com`). So it cannot front a tunnel —
> that was the whole point of the tunnel design (no port forwarding). The free path is a
> free domain hosted on Cloudflare's free plan (§1–§2). Keep `synology.me` for DSM access
> only, or skip Cloudflare entirely with a quick tunnel (§2b, testing only).

---

## 1. Prerequisites (laptop + accounts)

1. **Cloudflare account** (free): https://dash.cloudflare.com/sign-up
2. **A free domain** hosted on Cloudflare (pick one):
   - **DigitalPlat US.KG** — free subdomain (`yourname.us.kg`), instant dashboard, works with
     Cloudflare: https://dash.domain.digitalplat.org → register → change nameservers to
     Cloudflare's (given in §2).
   - **eu.org** — free `yourname.eu.org`, approval can take days/weeks.
   - **Cheapest real domain** (~$1–2/yr, e.g. `.xyz` on Cloudflare Registrar / Porkbun) — the
     zero-friction option.
3. Laptop with the repo, Docker, and SSH access to the NAS (`ssh <your-ssh-user>@<nas-ip>`).

## 2. Domain → Cloudflare

1. dash.cloudflare.com → **Add a domain** → enter your free domain → plan **Free**.
2. Cloudflare shows **two nameservers** (e.g. `ada.ns.cloudflare.com`).
3. In the domain provider's panel replace its nameservers with Cloudflare's.
4. Wait for the "Active" email (US.KG: minutes; eu.org: after approval).
5. In Cloudflare → DNS: you may delete all pre-created records (the tunnel adds its own).

### §2b — Zero-setup alternative (testing only): quick tunnel
No account, no domain: run `docker compose -f docker-compose.prod.yml --profile tunnel ...`
with a **quick tunnel** instead (see §6 note). URL is random (`https://<random>.trycloudflare.com`)
and **changes on every restart** — PWA/refresh-cookie survive, but your CORS_ORIGIN/bookmarks
don't. Fine for a first smoke test; use §1–§2 for the real thing.

## 3. Create the tunnel (get the token)

1. Cloudflare dashboard → **Zero Trust** (left sidebar) → **Networks → Tunnels**.
2. **Create a tunnel** → connector type **Cloudflared** → name it `grocery`.
3. Cloudflare shows the install command containing the token
   (`cloudflared ... run --token eyJh...` — a long `eyJ…` string; the **tunnel ID** (a UUID)
   is embedded in it and shown on the tunnel page). Copy **the token** — that's all the
   compose file needs.
4. On the tunnel's **Public Hostname** tab → Add:
   - Subdomain: `grocery`, Domain: your free domain
   - Service: **HTTP** → `web:8080`
   (Save. This creates the CNAME `grocery.<domain> → <tunnel-id>.cfargotunnel.com`.)

## 4. Prepare the NAS

1. DSM → **Package Center** → install **Container Manager** (this is the Docker engine).
2. Enable SSH: DSM → **Control Panel → Terminal & SNMP → Enable SSH**.
3. SSH in and create the app folder. **Use your own SSH-enabled user** (the built-in `admin`
   is disabled by default on DSM 7; `ssh <your-ssh-user>@<nas-ip>`).
   - **Where are my disks?** On Synology the storage is mounted under `/volume1` (sometimes
     `/volume2` for a second pool). If `ls /` doesn't show it from your user, look at
     `ls /volume*` via sudo, or find where DSM stores shared folders:
     `sudo ls /volume1/` (you should see `docker`, `homes`, `photo`, …).
   - If your volume is not `/volume1`, replace it in **all** commands below.
   ```bash
   ssh <your-ssh-user>@<nas-ip>
   sudo -i                                  # become root for the setup steps
   ls /volume1                              # confirm the volume path
   # (optional) a data folder on the volume — the compose project itself lives in
   # ~/grocery (created by deploy.sh in §5); named volumes keep the app data.
   mkdir -p /volume1/docker/grocery && chown <your-ssh-user>:users /volume1/docker/grocery
   # Allow non-root docker over SSH (deploy.sh pipes `docker save | ssh … docker load`):
   # DSM's docker socket is root-only; add your user to the docker group so the transfer
   # step doesn't need root. (Group appears as "docker" in DSM's group list after this.)
   synogroup --add docker <your-ssh-user>
   chown root:docker /var/run/docker.sock
   exit                                     # back to your user; re-login for the group to apply
   ```
   > On DSM 7.2+ Container Manager, the `docker` group may already exist — `synogroup
   > --add docker <user>` then just **adds your user to it**. Verify with `id <user>` after
   > re-login: `docker` must appear in groups.
   - If `sudo` says your user is not in the sudoers/administrators group: DSM → **Control
     Panel → Users → your user → Edit → check "administrators"** (SSH users must be in the
     administrators group to sudo).
   (Named volumes are used for data — `data` and `uploads` are created by compose on first
   boot and inherit the container's `app` user ownership automatically. No manual chown
   needed; see `docs/LOCAL_DOCKER.md` only if you switch to bind mounts.)

## 5. Transfer the images (laptop → NAS)

On the **laptop** (arm64 images, same platform as the NAS):

```bash
./scripts/build-images.sh                       # builds + tags grocery-api / grocery-web
./scripts/deploy.sh <your-ssh-user>@<nas-ip>    # docker save | ssh docker load
```

What `deploy.sh` does: loads both images into the NAS docker, **creates `~/grocery/` on the
NAS** and copies `docker-compose.prod.yml` there, then prints the next steps. The compose
project lives at `~/grocery` (= `/var/services/homes/<user>/grocery`) — not `/volume1`;
named volumes keep the data, so the folder location doesn't matter.

DSM PATH quirk: the docker CLI lives at **`/usr/local/bin/docker`** and is NOT on the PATH of
non-interactive SSH commands — the script handles it; on the NAS use the full path too.

## 6. Compose project on the NAS

SSH in: `ssh <your-ssh-user>@<nas-ip>` — everything below runs in `~/grocery`:

1. **Generate a JWT secret on the laptop** (or any long random string):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
2. **Create `~/grocery/.env` on the NAS**:
   ```bash
   cd ~/grocery
   cat > .env << 'EOF'
   JWT_SECRET=<paste from step 1>
   TUNNEL_TOKEN=<eyJ… token from §3 step 3>
   CORS_ORIGIN=https://grocery.<your-domain>
   EOF
   chmod 600 .env
   ```
   (`WEB_PORT` is optional — 8080 is the default and what the tunnel routes to.)
3. **Start:**
   ```bash
   /usr/local/bin/docker compose -f docker-compose.prod.yml --profile tunnel --env-file .env up -d
   /usr/local/bin/docker compose -f docker-compose.prod.yml ps
   ```
   → api + web + tunnel all `(healthy)`. Healthchecks gate the order: api → web → tunnel.
   The tunnel restart-loops until the token is valid.
4. **Boot persistence:** `restart: unless-stopped` + Container Manager autostart covers
   reboots. Verify after a test reboot; if the stack doesn't come up, add a boot-up
   **Task Scheduler** task (root, "On boot-up"):
   ```bash
   cd /var/services/homes/<user>/grocery && /usr/local/bin/docker compose -f docker-compose.prod.yml --profile tunnel --env-file .env up -d
   ```

> **Quick tunnel (§2b)** replaces `TUNNEL_TOKEN` with `command: tunnel --url http://web:8080`
> in a one-off compose override — the URL is printed in `docker logs grocery-list-tunnel-1`.

## 7. First boot + first admin

1. Open `https://grocery.<your-domain>` → login page over HTTPS (Cloudflare edge cert).
2. **Create the first admin** (there is no register endpoint by design):
   - On the **laptop**, hash the password (never paste a plain password):
     ```bash
     node -e "console.log(require('./apps/api/node_modules/bcryptjs').hashSync(process.argv[1], 10))" 'YOUR-PASSWORD'
     # → $2b$10$...
     ```
   - On the **NAS** (safe while the api runs; busy_timeout guards the single-writer lock):
     ```bash
     cd ~/grocery
     HASH='$2b$10$…'      # single-quoted so the $ signs stay literal
     /usr/local/bin/docker compose -f docker-compose.prod.yml --env-file .env exec -T api node -e '
       const db = require("better-sqlite3")("/data/grocery.db", { timeout: 5000 });
       const [email, hash] = process.argv.slice(1);
       db.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)")
         .run(require("node:crypto").randomBytes(16).toString("hex"), email, hash, "admin");
       console.log("admin created:", email);
       db.close();
     ' "you@example.com" "$HASH"
     ```
3. Log in at `https://grocery.<your-domain>` with that email + password. Create everyone else
   in the app as admin (**menu → Admin → Users**, `POST /users` — T32), and API tokens for
   agents (menu → Admin → API tokens? — Settings, `POST /api/api-tokens`, `glc_…` shown once).
4. Phone check (on **mobile data**, not Wi-Fi): open the URL, log in, install the PWA
   (Add to Home Screen), confirm offline shell + login-once.

## 8. Verify everything (checklist)

- [ ] `https://grocery.<domain>/api/health` → `{"status":"ok"}` from mobile network
- [ ] login → lists/items load; reload keeps the session (silent refresh)
- [ ] add item / move to bought / edit details / upload image (≤ 600 px webp at `/static/…`)
- [ ] price added → chart + newest-first history rows
- [ ] PWA installed on Android **and** iOS; full-screen; re-open keeps login
- [ ] memory: `docker stats --no-stream` → total < 150 MB (api ~75 + web ~7 + tunnel ~20)
- [ ] reboot the NAS once → everything comes back without touching anything

## 9. Backups & upgrades

- Backups: `docs/DEPLOYMENT.md` §10 (daily SQLite `.backup` + weekly uploads tar via DSM
  Task Scheduler).
- Upgrades: laptop `git pull && ./scripts/build-images.sh && ./scripts/deploy.sh <your-ssh-user>@<nas-ip>`
  then on the NAS in `~/grocery`:
  `/usr/local/bin/docker compose -f docker-compose.prod.yml --profile tunnel --env-file .env up -d`
  (recreates on image change). **PWA note:** users must reload once (twice until T47's
  update-toast ships) to get the new shell.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Tunnel restart-loops | wrong/expired `TUNNEL_TOKEN` in `.env` |
| `CORS_ORIGIN` boot error | must be `https://grocery.<your-domain>` exactly (prod fail-fast, T34) |
| 522/530 from Cloudflare | web or api unhealthy → `docker compose ps`, check `docker logs` |
| Login works on LAN, fails via tunnel | `CORS_ORIGIN` mismatch with the tunnel hostname |
| Uploads → 500 EACCES | volume owned by root (pre-T21 creation) → `docker run --rm -v grocery-list_uploads:/d alpine chown -R 100:101 /d` |
| UI stale after deploy | service worker precache — reload twice (T47 will add a toast) |
| `permission denied … /var/run/docker.sock` over SSH | your user is not in the **docker** group → `sudo synogroup --add docker <user>` then `sudo chown root:docker /var/run/docker.sock` and re-login (see §4) |