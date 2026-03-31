#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[workspace-governance-switch-gate] $*"; }

info "running backend-real workspace governance matrix with external Keycloak switch"
(cd "${ROOT_DIR}" && bash scripts/run-integration-e2e-full.sh e2e/integration-workspace-project-governance-matrix.spec.ts)

info "workspace governance switch gate passed"
