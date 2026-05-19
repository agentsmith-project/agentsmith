#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

INTERNAL_MODE_STATUS="disabled"
if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
  INTERNAL_MODE_STATUS="configured"
  if INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" status | grep -q '^asbcp_alive=1$'; then
    INTERNAL_MODE_STATUS="enabled"
  fi
fi
echo "Internal mode: ${INTERNAL_MODE_STATUS}"
echo "ASBCP URL: ${ASBCP_INTERNAL_BASE_URL_VALUE}"
echo "AFSCP API: $(afscp_api_status)"
if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" status || true
else
  echo "asbcp_pid="
  echo "asbcp_alive=0"
  echo "asbcp_container_running=0"
  echo "asbcp_listener_pids="
  echo "asbcp_ready=0"
fi
echo "Runner socket: $(runner_socket_health_state)"
echo "Namespace: ${K8S_NAMESPACE}"
echo "Namespace exists: $(kubectl get namespace "${K8S_NAMESPACE}" >/dev/null 2>&1 && echo yes || echo no)"
echo "AFSCP storage CSI driver: ${CSI_DRIVER}"
CSI_DRIVER_PRESENT="$(kubectl get csidriver "${CSI_DRIVER}" >/dev/null 2>&1 && echo yes || echo no)"
CSI_NODE_READY="unknown"
if kubectl get daemonset juicefs-csi-node -n "${AFSCP_STORAGE_CSI_NAMESPACE}" >/dev/null 2>&1; then
  CSI_NODE_READY="$(
    kubectl get daemonset juicefs-csi-node -n "${AFSCP_STORAGE_CSI_NAMESPACE}" -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}' 2>/dev/null || echo unknown
  )"
fi
echo "AFSCP storage CSI ready: ${CSI_DRIVER_PRESENT}"
echo "AFSCP storage CSI node ready: ${CSI_NODE_READY}"
echo "Latest workload pod: $(kubectl get pods -n "${K8S_NAMESPACE}" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
