#!/usr/bin/env bash
# T21: build production arm64 images on the laptop (Docker on Apple Silicon is arm64-native;
# on Intel use the buildx line as-is — it emulates via QEMU).
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="${PLATFORM:-linux/arm64}"
API_TAG="${API_TAG:-grocery-api:latest}"
WEB_TAG="${WEB_TAG:-grocery-web:latest}"

build() {
  local image="$1" context="$2" dockerfile="$3"
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build --platform "$PLATFORM" -t "$image" -f "$dockerfile" --load "$context"
  else
    docker build --platform "$PLATFORM" -t "$image" -f "$dockerfile" "$context"
  fi
}

build "$API_TAG" . apps/api/Dockerfile
build "$WEB_TAG" . apps/web/Dockerfile

echo "Built $API_TAG and $WEB_TAG for $PLATFORM."
