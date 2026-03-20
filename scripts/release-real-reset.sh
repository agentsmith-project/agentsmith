#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

STATE_DIR="$(real_lane_state_root)"
SANDBOX_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"

info() { echo "[release-real-reset] $*"; }

info "clearing real-lane state under ${STATE_DIR}"
rm -rf "${STATE_DIR}"
ensure_real_lane_state

if command -v docker >/dev/null 2>&1; then
  info "resetting integration docker volumes"
  (cd "${ROOT_DIR}" && npm run integration:deps:down:volumes >/dev/null)
fi

if command -v kubectl >/dev/null 2>&1; then
  info "deleting sandbox namespace ${SANDBOX_NAMESPACE}"
  kubectl delete namespace "${SANDBOX_NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
  kubectl get pv -o name 2>/dev/null | grep 'juicefs' | xargs -r kubectl delete >/dev/null 2>&1 || true
fi

state_set_string release.phase "reset_completed"
state_set_string release.last_reset_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[release-real-reset] done"
