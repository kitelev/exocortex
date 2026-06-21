#!/usr/bin/env bash
# =============================================================================
#  One-command runner for the EKA "Obsidian leg" e2e test (PLUGIN path) in Docker
# =============================================================================
#
#  Drives the full alpha path (bootstrap → add → apply-profile → create) through
#  the Exocortex plugin against LIVE GitHub, in an ephemeral vault, inside a
#  containerised Obsidian (xvfb). Requires a PAT with read access to the private
#  kitelev/exoas-* repos.
#
#  Usage:
#     export EKA_E2E_PAT=$(gh auth token)     # kitelev → private exoas-* access
#     packages/obsidian-plugin/scripts/test-eka-obsidian-leg.sh
#
#  Env:
#     EKA_E2E_PAT   (required) GitHub PAT. Falls back to `gh auth token`.
#     BASE_IMAGE    (optional) defaults to ghcr.io/kitelev/exocortex-ci:latest
#     PLATFORM      (optional) defaults to linux/amd64 (base is amd64-only;
#                              QEMU emulation on Apple Silicon).
#     SKIP_BUILD    (optional) =1 to skip the plugin + docker image build.
#
#  This test is NOT one of the 13 required CI checks — it hits live private
#  repos and must stay opt-in. See the spec header for the isolation contract.
# =============================================================================
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-ghcr.io/kitelev/exocortex-ci:latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE="exocortex-eka-e2e:local"

# Resolve the PAT (explicit env wins, else gh auth token).
EKA_E2E_PAT="${EKA_E2E_PAT:-$(gh auth token 2>/dev/null || true)}"
if [ -z "${EKA_E2E_PAT}" ]; then
  echo "ERROR: EKA_E2E_PAT is required (export it or run 'gh auth login')." >&2
  exit 2
fi

cd "$REPO_ROOT"

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "== Building plugin (main.js) =="
  npm run build -w @kitelev/exocortex-core >/dev/null
  npm run build -w @kitelev/exocortex-services >/dev/null
  node packages/obsidian-plugin/esbuild.config.mjs production

  echo "== Pulling base image ($BASE_IMAGE, $PLATFORM) =="
  docker pull --platform "$PLATFORM" "$BASE_IMAGE"

  echo "== Building EKA e2e image =="
  docker build \
    --platform "$PLATFORM" \
    --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    -f packages/obsidian-plugin/Dockerfile.eka-e2e \
    -t "$IMAGE" \
    "$REPO_ROOT"
fi

echo "== Running EKA Obsidian-leg e2e in Docker =="
docker run --rm \
  --platform "$PLATFORM" \
  -e EKA_E2E_PAT="$EKA_E2E_PAT" \
  "$IMAGE"
