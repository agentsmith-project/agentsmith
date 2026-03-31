#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[cluster-hotfix-regression-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "bash -n scripts/cluster-deploy/*.sh scripts/scenarios/cluster-rehearsal/*.sh scripts/lib/deploy-common.sh"
run_cmd "npm run test:cluster-bundle:inputs"
run_cmd "npm run test:cluster-rendered-env"

info "cluster hotfix regression gate passed"
