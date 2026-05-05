#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[internal-ownership-backend-real-gate] $*"; }

info "running local internal smoke"
(cd "${ROOT_DIR}" && bash scripts/local-manual-internal-smoke.sh)

info "running backend-real internal agent-task gate"
(cd "${ROOT_DIR}" && bash scripts/run-internal-agent-task-real-gate.sh)

info "internal ownership backend-real gate passed"
