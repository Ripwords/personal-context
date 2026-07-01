#!/usr/bin/env bash
# Build only the app Docker image for a remote server, save it to a gzipped
# tarball, and print transfer/load instructions.
#
# Use this for the common fast path when application code changed but DB
# migrations did not. If migrations changed, use scripts/build-images.sh.
#
# HOW IT WORKS (and why): the Bun/Nuxt bundler segfaults under QEMU when
# cross-building linux/amd64 from Apple Silicon. So we run `bun run build`
# NATIVELY on this machine to produce .output (portable, pure-JS), then build a
# thin ${PLATFORM} image (Dockerfile.ship) that only COPYies that bundle — a
# file copy, no emulated compilation. Fast and reliable.
#
# Usage:
#   ./scripts/build-app-image.sh
#
# Env overrides:
#   IMAGE_REGISTRY=braindump   # image name prefix (must match .env on server)
#   IMAGE_TAG=latest           # image tag       (must match .env on server)
#   PLATFORM=linux/amd64       # target arch of the server (linux/arm64 if ARM)
#   SKIP_BUILD=1               # reuse an existing .output (skip bun run build)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/dist"
OUT_FILE="${OUT_DIR}/braindump-app.tar.gz"
PLATFORM="${PLATFORM:-linux/amd64}"

IMAGE_REGISTRY="${IMAGE_REGISTRY:-braindump}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_IMAGE="${IMAGE_REGISTRY}/app:${IMAGE_TAG}"

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

echo "→ saving image to ${OUT_FILE}"
docker save "${APP_IMAGE}" | gzip > "${OUT_FILE}"

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
#    scp dist/braindump-app.tar.gz user@server:~/
#
#    # or stream straight in (no temp file on the server):
#    gunzip -c dist/braindump-app.tar.gz | ssh -t user@server 'sudo docker load'

# 2. On the server, load and swap only the app container:
#
#    ssh user@server
#    gunzip -c ~/braindump-app.tar.gz | sudo docker load
#    rm ~/braindump-app.tar.gz
#    cd ~/personal-context && git pull --ff-only   # refresh compose if changed
#    sudo docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate app

# 3. Verify:
#
#    sudo docker compose -f docker-compose.prod.yml ps app
#    curl -fsS http://127.0.0.1:${APP_PORT:-3000}/api/health && echo   # → {"status":"ok",...}

EOF
