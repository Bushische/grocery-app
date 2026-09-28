#!/usr/bin/env bash
# T21: transfer the built images to the NAS over SSH (docker save | docker load) and boot
# the production stack there. No registry needed.
#
# Usage: ./scripts/deploy.sh [user@host]     (arg) or NAS_HOST=user@synology (env)
# Optional env: API_TAG (default grocery-api:latest), WEB_TAG, COMPOSE_FILE
# (default docker-compose.prod.yml), plus the usual -- just-run-upload mode below.
set -euo pipefail
cd "$(dirname "$0")/.."

NAS_HOST="${1:-${NAS_HOST:-}}"
if [ -z "$NAS_HOST" ]; then
  echo "usage: $0 <user@nas-ip>   (or: NAS_HOST=user@nas-ip $0)" >&2
  exit 1
fi
API_TAG="${API_TAG:-grocery-api:latest}"
WEB_TAG="${WEB_TAG:-grocery-web:latest}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

transferred=0
for tag in "$API_TAG" "$WEB_TAG"; do
  if docker image inspect "$tag" >/dev/null 2>&1; then
    echo ">>> transferring $tag"
    docker save "$tag" | ssh "$NAS_HOST" docker load
    transferred=$((transferred + 1))
  else
    echo "!! image $tag not found locally — run ./scripts/build-images.sh first" >&2
    exit 1
  fi
done

echo ">>> transferring compose file"
scp "$COMPOSE_FILE" "$NAS_HOST:grocery/$COMPOSE_FILE"

cat <<EOF

Images transferred ($transferred). On the NAS run:

  cd ~/grocery
  # create .env from .env.prod.example (JWT_SECRET, CORS_ORIGIN, …)
  docker compose -f $COMPOSE_FILE --env-file .env up -d
EOF
