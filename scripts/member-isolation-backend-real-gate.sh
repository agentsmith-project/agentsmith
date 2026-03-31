#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[member-isolation-backend-real-gate] $*"; }
die() { echo "[member-isolation-backend-real-gate] $*" >&2; exit 1; }

if [[ -z "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" ]]; then
  if curl -fsS "http://127.0.0.1:39080/admin/state" >/dev/null 2>&1; then
    export MBOS_UNIVERSAL_PROXY_BASE_URL="http://127.0.0.1:39080"
  fi
fi

[[ -n "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" ]] || die "missing MBOS_UNIVERSAL_PROXY_BASE_URL; start substrate or export the universal proxy base url first"
curl -fsS "${MBOS_UNIVERSAL_PROXY_BASE_URL}/admin/state" >/dev/null 2>&1 \
  || die "universal proxy is not reachable at ${MBOS_UNIVERSAL_PROXY_BASE_URL}"

run_spec() {
  local spec="$1"
  info "running ${spec}"
  (cd "${ROOT_DIR}" && bash scripts/run-integration-e2e-full.sh "${spec}")
}

run_spec e2e/integration-membership-chat-isolation.spec.ts
run_spec e2e/integration-external-task-isolation.spec.ts
run_spec e2e/integration-usage-self-scope.spec.ts
run_spec e2e/integration-agent-member-permissions.spec.ts

info "member isolation backend-real gate passed"
