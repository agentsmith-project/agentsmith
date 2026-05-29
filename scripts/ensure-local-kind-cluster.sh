#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/kind-cluster-bootstrap.sh"
CLUSTER_NAME="${1:-${LOCAL_KIND_CLUSTER_NAME:-agentsmith}}"
CONFIG_PATH="${2:-${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/unified/local-kind/config.yaml}}"
CONTROL_PLANE_NODE="${3:-${LOCAL_KIND_CONTROL_PLANE_NODE_NAME:-${CLUSTER_NAME}-control-plane}}"
KIND_CONTEXT="kind-${CLUSTER_NAME}"
LOCAL_KIND_STATE_ROOT="${LOCAL_KIND_STATE_ROOT:-${HOME}/agentsmith/local-kind}"
KUBECONFIG_DIR="${LOCAL_KIND_KUBECONFIG_DIR:-${LOCAL_KIND_STATE_ROOT}/kubeconfig}"
FINAL_KUBECONFIG_PATH="${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-${KUBECONFIG_DIR}/${KIND_CONTEXT}.config}"
EXPORT_KUBECONFIG_PATH="${LOCAL_KIND_EXPORT_KUBECONFIG_PATH:-${KUBECONFIG_DIR}/${KIND_CONTEXT}.exported.conf}"
SUPER_ADMIN_RAW_KUBECONFIG_PATH="${LOCAL_KIND_SUPER_ADMIN_RAW_KUBECONFIG_PATH:-${KUBECONFIG_DIR}/${KIND_CONTEXT}.super-admin.raw.conf}"
SUPER_ADMIN_KUBECONFIG_PATH="${LOCAL_KIND_SUPER_ADMIN_KUBECONFIG_PATH:-${KUBECONFIG_DIR}/${KIND_CONTEXT}.super-admin.conf}"
HOST_DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-${HOME}/.docker}"
KIND_DOCKER_CONFIG_DIR=""
LOCAL_KIND_BIN="${LOCAL_KIND_BIN:-$(command -v kind)}"
LOCAL_KIND_KUBECTL_BIN="${LOCAL_KIND_KUBECTL_BIN:-$(command -v kubectl)}"
LOCAL_KIND_NODE_IMAGE_ARCHIVE="${LOCAL_KIND_NODE_IMAGE_ARCHIVE:-}"

kind_image_tar_name() {
  printf '%s' "$1" | tr '/:@' '---'
}

kind_kubectl() {
  "${LOCAL_KIND_KUBECTL_BIN}" "$@"
}

cleanup_kind_docker_config() {
  if [[ -n "${KIND_DOCKER_CONFIG_DIR}" ]]; then
    rm -rf "${KIND_DOCKER_CONFIG_DIR}"
  fi
}
trap cleanup_kind_docker_config EXIT

prepare_kind_docker_config() {
  KIND_DOCKER_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentsmith-kind-docker-config.XXXXXX")"
  kind_write_docker_config_without_proxies \
    "${HOST_DOCKER_CONFIG_DIR}/config.json" \
    "${KIND_DOCKER_CONFIG_DIR}/config.json"
}

kind_cmd() {
  DOCKER_CONFIG="${KIND_DOCKER_CONFIG_DIR}" "${LOCAL_KIND_BIN}" "$@"
}

current_api_server() {
  docker port "${CONTROL_PLANE_NODE}" 6443/tcp 2>/dev/null | awk 'NR==1 {print $NF}'
}

write_super_admin_kubeconfig() {
  mkdir -p "${KUBECONFIG_DIR}" "$(dirname "${FINAL_KUBECONFIG_PATH}")"
  KUBECONFIG="${EXPORT_KUBECONFIG_PATH}" kind_cmd export kubeconfig --name "${CLUSTER_NAME}" >/dev/null
  docker cp "${CONTROL_PLANE_NODE}:/etc/kubernetes/super-admin.conf" "${SUPER_ADMIN_RAW_KUBECONFIG_PATH}" >/dev/null

  local cert_b64 key_b64 server cert_file key_file
  cert_b64="$(
    KUBECONFIG="${SUPER_ADMIN_RAW_KUBECONFIG_PATH}" \
      kind_kubectl config view --raw --minify -o jsonpath='{.users[0].user.client-certificate-data}'
  )"
  key_b64="$(
    KUBECONFIG="${SUPER_ADMIN_RAW_KUBECONFIG_PATH}" \
      kind_kubectl config view --raw --minify -o jsonpath='{.users[0].user.client-key-data}'
  )"
  server="$(current_api_server)"
  [[ -n "${server}" ]] || {
    echo "[kind-bootstrap] ERROR: failed to resolve API server port for ${CONTROL_PLANE_NODE}" >&2
    return 1
  }

  cert_file="$(mktemp "${KUBECONFIG_DIR}/${KIND_CONTEXT}.cert.XXXXXX.crt")"
  key_file="$(mktemp "${KUBECONFIG_DIR}/${KIND_CONTEXT}.key.XXXXXX.key")"
  printf '%s' "${cert_b64}" | base64 -d > "${cert_file}"
  printf '%s' "${key_b64}" | base64 -d > "${key_file}"

  KUBECONFIG="${EXPORT_KUBECONFIG_PATH}" kind_kubectl config set-cluster "${KIND_CONTEXT}" --server="https://${server}" >/dev/null
  KUBECONFIG="${EXPORT_KUBECONFIG_PATH}" \
    kind_kubectl config set-credentials "${KIND_CONTEXT}-super-admin" \
      --client-certificate="${cert_file}" \
      --client-key="${key_file}" \
      --embed-certs=true \
      >/dev/null
  KUBECONFIG="${EXPORT_KUBECONFIG_PATH}" \
    kind_kubectl config set-context "${KIND_CONTEXT}" \
      --cluster="${KIND_CONTEXT}" \
      --user="${KIND_CONTEXT}-super-admin" \
      >/dev/null
  KUBECONFIG="${EXPORT_KUBECONFIG_PATH}" kind_kubectl config use-context "${KIND_CONTEXT}" >/dev/null

  cp "${EXPORT_KUBECONFIG_PATH}" "${SUPER_ADMIN_KUBECONFIG_PATH}"
  cp "${EXPORT_KUBECONFIG_PATH}" "${FINAL_KUBECONFIG_PATH}"
  rm -f "${cert_file}" "${key_file}"
}

kind_cluster_ready() {
  write_super_admin_kubeconfig >/dev/null 2>&1 || return 1
  KUBECONFIG="${SUPER_ADMIN_KUBECONFIG_PATH}" kind_kubectl --context "${KIND_CONTEXT}" get --raw='/readyz' >/dev/null 2>&1 || return 1
  KUBECONFIG="${SUPER_ADMIN_KUBECONFIG_PATH}" kind_kubectl --context "${KIND_CONTEXT}" get ns >/dev/null 2>&1 || return 1
  KUBECONFIG="${SUPER_ADMIN_KUBECONFIG_PATH}" kind_kubectl --context "${KIND_CONTEXT}" get node "${CONTROL_PLANE_NODE}" >/dev/null 2>&1 || return 1
}

wait_for_kind_cluster_ready() {
  local timeout_seconds="${1:-180}"
  local deadline
  deadline="$((SECONDS + timeout_seconds))"
  while (( SECONDS < deadline )); do
    if kind_cluster_ready; then
      return 0
    fi
    sleep 2
  done
  return 1
}

finalize_kind_cluster_bootstrap() {
  write_super_admin_kubeconfig >/dev/null
  kind_reconcile_coredns_upstreams "${SUPER_ADMIN_KUBECONFIG_PATH}"
  KUBECONFIG="${SUPER_ADMIN_KUBECONFIG_PATH}" kind_kubectl config use-context "${KIND_CONTEXT}" >/dev/null
  KUBECONFIG="${SUPER_ADMIN_KUBECONFIG_PATH}" kind_kubectl label node "${CONTROL_PLANE_NODE}" node=mbos --overwrite >/dev/null
}

kind_cluster_healthy() {
  kind_cmd get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}" || return 1
  docker ps --format '{{.Names}}' | grep -qx "${CONTROL_PLANE_NODE}" || return 1
  docker exec "${CONTROL_PLANE_NODE}" systemctl is-active containerd >/dev/null 2>&1 || return 1
  kind_cluster_ready || return 1
}

create_and_sanitize_kind_cluster() {
  kind_cmd create cluster --name "${CLUSTER_NAME}" --config "${CONFIG_PATH}" >/dev/null
  kind_sanitize_control_plane_proxy_env "${CONTROL_PLANE_NODE}"
}

ensure_kind_node_image_present() {
  local kind_node_image="$1"
  if docker image inspect "${kind_node_image}" >/dev/null 2>&1; then
    return 0
  fi

  local archive_path="${LOCAL_KIND_NODE_IMAGE_ARCHIVE}"
  if [[ -n "${archive_path}" ]]; then
    [[ -f "${archive_path}" ]] || {
      echo "[kind-bootstrap] ERROR: missing local kind node image ${kind_node_image}; expected archive at ${archive_path}" >&2
      return 1
    }
    docker load -i "${archive_path}" >/dev/null
    return 0
  fi

  if [[ -n "${LOCAL_KIND_RELEASE_ROOT:-}" ]]; then
    archive_path="${LOCAL_KIND_RELEASE_ROOT}/images/$(kind_image_tar_name "${kind_node_image}").tar"
    [[ -f "${archive_path}" ]] || {
      echo "[kind-bootstrap] ERROR: missing local kind node image ${kind_node_image}; expected archive at ${archive_path}" >&2
      return 1
    }
    docker load -i "${archive_path}" >/dev/null
    return 0
  fi

  docker pull "${kind_node_image}" >/dev/null || {
    echo "[kind-bootstrap] ERROR: failed to pull kind node image ${kind_node_image}" >&2
    return 1
  }
}

ensure_local_kind_cluster() {
  prepare_kind_docker_config

  local kind_node_image
  kind_node_image="$(awk '/image:/ {print $2; exit}' "${CONFIG_PATH}")"
  [[ -n "${kind_node_image}" ]] || {
    echo "[kind-bootstrap] ERROR: failed to resolve node image from ${CONFIG_PATH}" >&2
    return 1
  }
  ensure_kind_node_image_present "${kind_node_image}"

  if kind_cmd get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}" && ! kind_cluster_healthy; then
    if docker ps --format '{{.Names}}' | grep -qx "${CONTROL_PLANE_NODE}"; then
      kind_sanitize_control_plane_proxy_env "${CONTROL_PLANE_NODE}" || true
      if wait_for_kind_cluster_ready 120; then
        finalize_kind_cluster_bootstrap
        return 0
      fi
    fi
    echo "[kind-bootstrap] recreating unhealthy kind cluster ${CLUSTER_NAME}" >&2
    kind_cmd delete cluster --name "${CLUSTER_NAME}" >/dev/null || true
    sleep 2
  fi

  if ! kind_cmd get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
    if docker ps -a --format '{{.Names}}' | grep -qx "${CONTROL_PLANE_NODE}"; then
      docker rm -f "${CONTROL_PLANE_NODE}" >/dev/null 2>&1 || true
    fi
    if ! create_and_sanitize_kind_cluster; then
      echo "[kind-bootstrap] kind cluster creation failed; deleting ${CLUSTER_NAME} and retrying once" >&2
      kind_cmd delete cluster --name "${CLUSTER_NAME}" >/dev/null || true
      sleep 2
      create_and_sanitize_kind_cluster
    fi
    if ! wait_for_kind_cluster_ready 360; then
      echo "[kind-bootstrap] kind cluster did not become healthy after bootstrap sanitization; deleting ${CLUSTER_NAME} and retrying once" >&2
      kind_cmd delete cluster --name "${CLUSTER_NAME}" >/dev/null || true
      sleep 2
      create_and_sanitize_kind_cluster
      wait_for_kind_cluster_ready 360
    fi
  fi

  wait_for_kind_cluster_ready 180
  finalize_kind_cluster_bootstrap
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  ensure_local_kind_cluster
fi
