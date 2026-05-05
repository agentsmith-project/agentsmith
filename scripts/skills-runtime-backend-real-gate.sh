#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[skills-runtime-backend-real-gate] $*"; }

info "delegating managed Agent Task skill runtime coverage to internal sandbox backend-real gate"
(cd "${ROOT_DIR}" && bash scripts/run-internal-agent-task-real-gate.sh --skills-runtime)
info "skill runtime backend-real gate passed"
