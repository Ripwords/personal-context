#!/usr/bin/env bash
# Build every app-owned Docker image for a remote server, bundle them into a
# single gzipped tarball, and print transfer/load instructions.
#
# The point: your server is slow, so we build here and ship a ready image
# instead of building on the server.
#
# Built services (match docker-compose.prod.yml):
#   - app             → ${IMAGE_REGISTRY}/app:${IMAGE_TAG}      (Dockerfile.ship)
#   - drizzle-migrate → ${IMAGE_REGISTRY}/migrate:${IMAGE_TAG}  (Dockerfile target=migrate)
#
# Not built (pulled on the server): postgres, ollama.
#
# HOW IT WORKS (and why): the Bun/Nuxt bundler segfaults under QEMU when
# cross-building linux/amd64 from Apple Silicon. So we run `bun run build`
# NATIVELY on this machine to produce .output (portable, pure-JS), then build a
# thin ${PLATFORM} app image (Dockerfile.ship) that only COPYies that bundle.
# The migrator image does not run the Nuxt bundler, so it can still be built
# directly for ${PLATFORM}.
#
# Usage:
#   ./scripts/build-images.sh
#
# Env overrides:
#   IMAGE_REGISTRY=braindump   # image name prefix (must match .env on the server)
#   IMAGE_TAG=latest           # image tag       (must match .env on the server)
#   PLATFORM=linux/amd64       # target arch of the server
#   SKIP_BUILD=1               # reuse an existing .output (skip bun run build)
#
# For an app-only rebuild (faster; skips the migrator), use
# scripts/build-app-image.sh instead.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/dist"
OUT_FILE="${OUT_DIR}/braindump-images.tar.gz"
PLATFORM="${PLATFORM:-linux/amd64}"

IMAGE_REGISTRY="${IMAGE_REGISTRY:-braindump}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_IMAGE="${IMAGE_REGISTRY}/app:${IMAGE_TAG}"
MIGRATE_IMAGE="${IMAGE_REGISTRY}/migrate:${IMAGE_TAG}"

mkdir -p "${OUT_DIR}"

cd "${REPO_ROOT}"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "→ installing deps (bun install --frozen-lockfile)"
  bun install --frozen-lockfile
  echo "→ building app bundle natively (bun run build → .output)"
  bun run build
fi

if [[ ! -d "${REPO_ROOT}/.output/server" ]]; then
  echo "✗ .output/server not found — run without SKIP_BUILD first." >&2
  exit 1
fi

echo "→ packaging ${APP_IMAGE} for ${PLATFORM} from prebuilt .output"
docker buildx build \
  --platform "${PLATFORM}" \
  --file "${REPO_ROOT}/Dockerfile.ship" \
  --target run \
  --tag "${APP_IMAGE}" \
  --load \
  "${REPO_ROOT}"

echo "→ building ${MIGRATE_IMAGE} for ${PLATFORM} (target=migrate)"
docker buildx build \
  --platform "${PLATFORM}" \
  --target migrate \
  --tag "${MIGRATE_IMAGE}" \
  --load \
  "${REPO_ROOT}"

echo "→ saving 2 images to ${OUT_FILE}"
docker save "${APP_IMAGE}" "${MIGRATE_IMAGE}" | gzip > "${OUT_FILE}"

SIZE="$(du -h "${OUT_FILE}" | cut -f1)"
echo
echo "✔ built and saved (${SIZE})"
echo "  ${OUT_FILE}"
echo
echo "──────────────────────────────────────────────────────────────────"
echo "Next steps — copy/paste, replace user@server with your target:"
echo "──────────────────────────────────────────────────────────────────"
cat <<'EOF'

# 1. Transfer (one of these):
#
#    scp dist/braindump-images.tar.gz user@server:~/
#
#    # or stream straight in (no temp file on the server):
#    gunzip -c dist/braindump-images.tar.gz | ssh -t user@server 'sudo docker load'

# 2. On the server, load and recreate the stack (no build on the slow box):
#
#    ssh user@server
#    gunzip -c ~/braindump-images.tar.gz | sudo docker load
#    rm ~/braindump-images.tar.gz
#    cd ~/personal-context && git pull --ff-only   # refresh compose + .env if changed
#    sudo docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate

# 3. Verify:
#
#    sudo docker compose -f docker-compose.prod.yml ps
#    # → postgres + app should be Up (app: healthy), drizzle-migrate Exited (0).
#
#    curl -fsS http://127.0.0.1:${APP_PORT:-3000}/api/health && echo   # → {"status":"ok",...}

EOF
