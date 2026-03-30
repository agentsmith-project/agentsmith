#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT:-${ROOT_DIR}/artifacts/runtime}"
ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE:-${SCENARIO_RUNTIME_ROOT}/active-scenario.lock}"

ensure_scenario_dirs() {
  mkdir -p "${SCENARIO_RUNTIME_ROOT}"
}

current_active_scenario() {
  [[ -f "${ACTIVE_SCENARIO_LOCK_FILE}" ]] || return 0
  cat "${ACTIVE_SCENARIO_LOCK_FILE}" 2>/dev/null || true
}

acquire_scenario_lock() {
  local scenario="$1"
  ensure_scenario_dirs
  local current="$(current_active_scenario)"
  if [[ -n "${current}" && "${current}" != "${scenario}" ]]; then
    echo "[scenario] ERROR: active scenario is ${current}; stop it before starting ${scenario}." >&2
    exit 1
  fi
  printf '%s
' "${scenario}" > "${ACTIVE_SCENARIO_LOCK_FILE}"
}

release_scenario_lock() {
  local scenario="$1"
  local current="$(current_active_scenario)"
  if [[ "${current}" == "${scenario}" ]]; then
    rm -f "${ACTIVE_SCENARIO_LOCK_FILE}"
  fi
}

clear_local_dev_substrate() {
  SUBSTRATE=local-dev bash "${ROOT_DIR}/scripts/substrate/down.sh" >/dev/null 2>&1 || true
}

ensure_local_kind_registry() {
  local registry_name="${LOCAL_KIND_REGISTRY_NAME:-kind-registry}"
  local registry_host_port="${LOCAL_KIND_REGISTRY_HOST_PORT:-5001}"
  local registry_container_port="${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-5000}"
  local registry_host="${LOCAL_KIND_REGISTRY_HOST:-127.0.0.1}"
  local registry_listen="${registry_host}:${registry_host_port}"

  if ! docker ps -a --format '{{.Names}}' | grep -qx "${registry_name}"; then
    docker run -d --restart=always -p "${registry_listen}:${registry_container_port}" --name "${registry_name}" registry:2 >/dev/null
  else
    docker start "${registry_name}" >/dev/null 2>&1 || true
  fi

  docker network connect kind "${registry_name}" >/dev/null 2>&1 || true

  curl -fsS "http://${registry_host}:${registry_host_port}/v2/_catalog" >/dev/null

  kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "kind-registry:${registry_container_port}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF
}

ensure_local_kind_cluster() {
  local cluster_name="${LOCAL_KIND_CLUSTER_NAME:-agentsmith}"
  local config_path="${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/demo/kind/config.yaml}"
  local kind_context="kind-${cluster_name}"
  local kind_node_image
  kind_node_image="$(awk '/image:/ {print $2; exit}' "${config_path}")"
  [[ -n "${kind_node_image}" ]] || {
    echo "[scenario] ERROR: failed to resolve local kind node image from ${config_path}" >&2
    return 1
  }
  if ! docker image inspect "${kind_node_image}" >/dev/null 2>&1; then
    docker pull "${kind_node_image}" >/dev/null
  fi
  if ! kind get clusters 2>/dev/null | grep -qx "${cluster_name}"; then
    kind create cluster --name "${cluster_name}" --config "${config_path}" --wait 5m >/dev/null
  fi
  mkdir -p "${HOME}/.kube" "${HOME}/agentsmith/cluster-deploy/config"
  kind export kubeconfig --name "${cluster_name}" >/dev/null
  kubectl config use-context "${kind_context}" >/dev/null || true
  ensure_local_kind_registry
  cp "${HOME}/.kube/config" "${HOME}/agentsmith/cluster-deploy/config/kubeconfig"
  cp "${HOME}/.kube/config" "${HOME}/agentsmith/cluster-deploy/config/admin-kubeconfig"
}
