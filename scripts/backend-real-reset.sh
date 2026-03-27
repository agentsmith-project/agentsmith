#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

STATE_DIR="$(backend_real_state_root)"
SANDBOX_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"

info() { echo "[backend-real-reset] $*"; }

wait_for_absent() {
  local kind="$1"
  local name="$2"
  local namespace="${3:-}"
  local timeout_sec="${4:-60}"
  local deadline=$((SECONDS + timeout_sec))
  while (( SECONDS < deadline )); do
    if [[ -n "${namespace}" ]]; then
      if ! kubectl get "${kind}" "${name}" -n "${namespace}" >/dev/null 2>&1; then
        return 0
      fi
    else
      if ! kubectl get "${kind}" "${name}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

info "clearing backend-real state under ${STATE_DIR}"
rm -rf "${STATE_DIR}"
ensure_backend_real_state

if command -v docker >/dev/null 2>&1; then
  info "resetting integration docker volumes"
  (cd "${ROOT_DIR}" && npm run integration:deps:down:volumes >/dev/null)
fi

if command -v kubectl >/dev/null 2>&1; then
  if kubectl get namespace "${SANDBOX_NAMESPACE}" >/dev/null 2>&1; then
    info "deleting sandbox PVCs in ${SANDBOX_NAMESPACE}"
    kubectl delete pvc --all -n "${SANDBOX_NAMESPACE}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  fi

  info "deleting JuiceFS mount pods"
  mount_pods="$(
    kubectl get pods -n kube-system -o name 2>/dev/null \
      | grep '^pod/juicefs-.*-juicefs-' \
      || true
  )"
  if [[ -n "${mount_pods}" ]]; then
    printf '%s\n' "${mount_pods}" | xargs -r kubectl delete -n kube-system --wait=false >/dev/null 2>&1 || true
  fi

  info "deleting JuiceFS PVs"
  juicefs_pvs="$(kubectl get pv -o name 2>/dev/null | grep 'juicefs' || true)"
  if [[ -n "${juicefs_pvs}" ]]; then
    printf '%s\n' "${juicefs_pvs}" | xargs -r kubectl delete --wait=false >/dev/null 2>&1 || true
    while read -r pv; do
      [[ -n "${pv}" ]] || continue
      pv_name="${pv#persistentvolume/}"
      if ! wait_for_absent persistentvolume "${pv_name}" "" 20; then
        info "clearing PV finalizers for ${pv_name}"
        kubectl patch persistentvolume "${pv_name}" --type=merge -p '{"metadata":{"finalizers":[]}}' >/dev/null 2>&1 || true
      fi
    done <<< "${juicefs_pvs}"
  fi

  info "deleting sandbox namespace ${SANDBOX_NAMESPACE}"
  kubectl delete namespace "${SANDBOX_NAMESPACE}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  if ! wait_for_absent namespace "${SANDBOX_NAMESPACE}" "" 30; then
    info "clearing namespace finalizers for ${SANDBOX_NAMESPACE}"
    kubectl patch namespace "${SANDBOX_NAMESPACE}" --type=merge -p '{"spec":{"finalizers":[]}}' >/dev/null 2>&1 || true
  fi
fi

state_set_string release.phase "reset_completed"
state_set_string release.last_reset_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backend-real-reset] done"
