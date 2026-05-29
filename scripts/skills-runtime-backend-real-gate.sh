#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[skills-runtime-backend-real-gate] $*"; }

if [[ -n "${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" || -n "${INTERNAL_AGENT_IMAGE:-}" || -n "${MANAGED_RUNNER_IMAGE:-}" ]]; then
  echo "[skills-runtime-backend-real-gate] --skills-runtime builds and pushes the current workspace runner image. unset them, or use --runner-projection-smoke for release-locked image coverage." >&2
  exit 1
fi
export INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1

info "delegating managed Agent Task skill runtime coverage to internal sandbox backend-real gate"
(cd "${ROOT_DIR}" && bash scripts/run-internal-agent-task-real-gate.sh --skills-runtime)
info "skill runtime backend-real gate passed"
