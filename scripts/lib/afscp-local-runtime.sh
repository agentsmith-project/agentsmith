#!/usr/bin/env bash
set -euo pipefail

AFSCP_LOCAL_RUNTIME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AFSCP_LOCAL_RUNTIME_ROOT_DIR="${ROOT_DIR:-$(cd "${AFSCP_LOCAL_RUNTIME_LIB_DIR}/../.." && pwd)}"

resolve_afscp_local_runtime_defaults() {
  local api_port="$1"
  local volume_prefix="${2:-vol_integration}"

  AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:$((api_port + 9030))}"
  AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:$((api_port + 9031))}"
  AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-${volume_prefix}_${api_port}}"
  AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"
  AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-agentsmith-local-afscp-product-token}"
  AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"
  AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-agentsmith-local-afscp-bootstrap-token}"
  AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-control-plane}"
  AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"

  export \
    AFSCP_BASE_URL \
    AFSCP_EXPORT_GATEWAY_BASE_URL \
    AFSCP_DEFAULT_VOLUME_ID \
    AFSCP_CALLER_SERVICE \
    AFSCP_SERVICE_TOKEN \
    AFSCP_BOOTSTRAP_CALLER_SERVICE \
    AFSCP_BOOTSTRAP_SERVICE_TOKEN \
    AFSCP_ORCHESTRATOR_CALLER_SERVICE \
    AFSCP_ORCHESTRATOR_SERVICE_TOKEN
}

prepare_afscp_gate_juicefs_from_image() {
  local runtime_dir="$1"
  local bin_dir="${runtime_dir}/bin"
  mkdir -p "${bin_dir}"
  AFSCP_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-}}" \
    AFSCP_JUICEFS_OUTPUT_PATH="${bin_dir}/juicefs" \
    bash "${AFSCP_LOCAL_RUNTIME_ROOT_DIR}/scripts/afscp-jvs-image-smoke.sh"
}

with_afscp_local_runtime_env() {
  local runtime_dir="$1"
  shift
  local runtime_command="${1:-}"

  (
    unset AFSCP_API_PORT AFSCP_API_LISTEN_ADDR AFSCP_EXPORT_GATEWAY_PORT AFSCP_EXPORT_GATEWAY_LISTEN_ADDR

    local afscp_database_url
    afscp_database_url="${AFSCP_LOCAL_RUNTIME_DATABASE_URL:-${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT:-25432}/mbos?sslmode=disable}}"

    export ENV_FILE=/dev/null
    export INTERNAL_REAL_DIR="${runtime_dir}"
    export PATH="${runtime_dir}/bin:${PATH}"
    export LD_LIBRARY_PATH="${runtime_dir}/bin/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
    export INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"
    if [[ -n "${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-}" ]]; then
      export LOCAL_KIND_FINAL_KUBECONFIG_PATH
    fi
    if [[ -n "${KUBECONFIG:-}" ]]; then
      export KUBECONFIG
    fi
    export AFSCP_ENVIRONMENT="${AFSCP_ENVIRONMENT:-local-real}"
    export AFSCP_LOCAL_RUNTIME_MODE="${AFSCP_LOCAL_RUNTIME_MODE:-image}"
    export AFSCP_LOCAL_RUNTIME_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.31@sha256:4b7f3f9251519faddc9f11632ae38a3553e4bc0e7f1c42016d247f7928abffeb}}"
    export AFSCP_BASE_URL
    export AFSCP_EXPORT_GATEWAY_BASE_URL
    export AFSCP_DEFAULT_VOLUME_ID
    export AFSCP_CALLER_SERVICE
    export AFSCP_SERVICE_TOKEN
    export AFSCP_BOOTSTRAP_CALLER_SERVICE
    export AFSCP_BOOTSTRAP_SERVICE_TOKEN
    export AFSCP_ORCHESTRATOR_CALLER_SERVICE
    export AFSCP_ORCHESTRATOR_SERVICE_TOKEN
    export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
    export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null
    export DATABASE_URL="${afscp_database_url}"
    export AFSCP_DATABASE_URL="${AFSCP_DATABASE_URL:-${afscp_database_url}}"
    export AFSCP_POSTGRES_DSN="${AFSCP_POSTGRES_DSN:-${afscp_database_url}}"
    export AFSCP_API_POSTGRES_DSN="${AFSCP_API_POSTGRES_DSN:-${afscp_database_url}}"
    export AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN:-${afscp_database_url}}"
    export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${AFSCP_EXPORT_GATEWAY_POSTGRES_DSN:-${afscp_database_url}}"
    export POSTGRES_PORT="${POSTGRES_PORT:-}"
    export MONGO_PORT="${MONGO_PORT:-}"
    export REDIS_PORT="${REDIS_PORT:-}"
    export MINIO_API_PORT="${MINIO_API_PORT:-${MINIO_PORT:-}}"
    export MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-}"
    export KEYCLOAK_PORT="${KEYCLOAK_PORT:-}"
    export SUBSTRATE_POSTGRES_PORT="${SUBSTRATE_POSTGRES_PORT:-${POSTGRES_PORT:-}}"
    export SUBSTRATE_MINIO_API_PORT="${SUBSTRATE_MINIO_API_PORT:-${MINIO_API_PORT:-${MINIO_PORT:-}}}"
    export MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT:-}}"
    export MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
    export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
    export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
    export MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
    export AFSCP_STORAGE_CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}"
    export AFSCP_STORAGE_CAPACITY="${AFSCP_STORAGE_CAPACITY:-1Pi}"
    export AFSCP_STORAGE_CLASS_NAME="${AFSCP_STORAGE_CLASS_NAME:-}"
    export AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${AFSCP_STORAGE_CSI_MOUNT_OPTIONS:-}"
    export AFSCP_STORAGE_CSI_SUBDIR="${AFSCP_STORAGE_CSI_SUBDIR:-}"
    export AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT:-}"
    export AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-}"
    export AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE:-kube-system}"

    if [[ "${AFSCP_LOCAL_RUNTIME_MODE}" == "image" && "${runtime_command}" == "ensure_afscp_local_runtime" ]]; then
      prepare_afscp_gate_juicefs_from_image "${runtime_dir}"
    fi

    # shellcheck disable=SC1091
    source "${AFSCP_LOCAL_RUNTIME_ROOT_DIR}/scripts/local-manual/internal-common.sh"
    "$@"
  )
}

ensure_afscp_local_runtime_for_gate() {
  local runtime_dir="$1"
  with_afscp_local_runtime_env "${runtime_dir}" ensure_afscp_local_runtime || return 1
  probe_afscp_read_export_for_gate "${runtime_dir}" || return 1
}

probe_afscp_read_export_for_gate() {
  local runtime_dir="$1"
  AFSCP_READ_EXPORT_PROBE_LOG="${AFSCP_READ_EXPORT_PROBE_LOG:-${runtime_dir}/afscp-read-export-probe.log}" \
    with_afscp_local_runtime_env "${runtime_dir}" node "${AFSCP_LOCAL_RUNTIME_ROOT_DIR}/scripts/lib/afscp-read-export-probe.mjs"
}

stop_afscp_local_runtime_for_gate() {
  local runtime_dir="$1"
  with_afscp_local_runtime_env "${runtime_dir}" stop_afscp_local_runtime
}

reset_afscp_local_runtime_for_gate() {
  local runtime_dir="$1"
  with_afscp_local_runtime_env "${runtime_dir}" reset_owned_afscp_local_runtime_for_gate
}
