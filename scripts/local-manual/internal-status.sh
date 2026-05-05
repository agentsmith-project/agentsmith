#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

INTERNAL_MODE_STATUS="disabled"
if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
  INTERNAL_MODE_STATUS="configured"
  if INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" status | grep -q '^manager_alive=1$'; then
    INTERNAL_MODE_STATUS="enabled"
  fi
fi
echo "Internal mode: ${INTERNAL_MODE_STATUS}"
echo "Sandbox manager URL: ${INTERNAL_SANDBOX_MANAGER_URL_VALUE}"
if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" status || true
else
  echo "manager_pid="
  echo "manager_alive=0"
  echo "manager_listener_pids="
  echo "manager_ready=0"
  echo "cleaner_pid="
  echo "cleaner_alive=0"
fi
echo "Runner socket: $(runner_socket_health_state)"
echo "Namespace: ${K8S_NAMESPACE}"
echo "Namespace exists: $(kubectl get namespace "${K8S_NAMESPACE}" >/dev/null 2>&1 && echo yes || echo no)"
echo "CSI driver: ${CSI_DRIVER}"
CSI_DRIVER_PRESENT="$(kubectl get csidriver "${CSI_DRIVER}" >/dev/null 2>&1 && echo yes || echo no)"
CSI_NODE_READY="unknown"
if kubectl get daemonset juicefs-csi-node -n kube-system >/dev/null 2>&1; then
  CSI_NODE_READY="$(
    kubectl get daemonset juicefs-csi-node -n kube-system -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}' 2>/dev/null || echo unknown
  )"
fi
echo "CSI ready: ${CSI_DRIVER_PRESENT}"
echo "CSI node ready: ${CSI_NODE_READY}"
echo "Latest workload pod: $(kubectl get pods -n "${K8S_NAMESPACE}" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
