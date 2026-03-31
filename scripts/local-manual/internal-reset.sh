#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

stop_internal_runtime
kubectl delete namespace "${K8S_NAMESPACE}" --ignore-not-found >/dev/null 2>&1 || true
rm -rf "${INTERNAL_REAL_DIR}"
state_set_string internal_agent.id ""
state_set_string internal_agent.name ""

bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"
