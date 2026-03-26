#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export REMOTE_DEPLOY_ROOT="${REMOTE_DEPLOY_ROOT:-${CLUSTER_DEPLOY_ROOT:-${HOME}/agentsmith/cluster-deploy}}"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh"

CLUSTER_DEPLOY_ROOT="${REMOTE_DEPLOY_ROOT}"
SHARED_REGISTRY_ENV="${CONFIG_DIR}/registry.env"
SHARED_KUBECONFIG="${CONFIG_DIR}/kubeconfig"
OPERATOR_CLUSTER_DIR="${ROOT_DIR}/.infra/cluster-deploy"
OPERATOR_SITE_ENV="${OPERATOR_CLUSTER_DIR}/site.env"
OPERATOR_REGISTRY_ENV="${OPERATOR_CLUSTER_DIR}/registry.env"
OPERATOR_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/kubeconfig"
export CLUSTER_DEPLOY_ROOT SHARED_REGISTRY_ENV SHARED_KUBECONFIG OPERATOR_CLUSTER_DIR OPERATOR_SITE_ENV OPERATOR_REGISTRY_ENV OPERATOR_KUBECONFIG

log() { printf '[cluster-deploy] %s\n' "$*"; }
die() { printf '[cluster-deploy] ERROR: %s\n' "$*" >&2; exit 1; }

ensure_operator_site_env() {
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"

  if [[ ! -f "${SHARED_SITE_ENV}" ]]; then
    if [[ -f "${OPERATOR_SITE_ENV}" ]]; then
      cp "${OPERATOR_SITE_ENV}" "${SHARED_SITE_ENV}"
    elif [[ -f "${CURRENT_LINK}/env/site.env" ]]; then
      cp "${CURRENT_LINK}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env" ]]; then
      cp "${RELEASE_ROOT}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env.example" ]]; then
      cp "${RELEASE_ROOT}/env/site.env.example" "${SHARED_SITE_ENV}"
      die "missing site.env; template copied to ${SHARED_SITE_ENV}"
    else
      die "missing site.env in operator files, shared config, and release examples"
    fi
  fi

  cp "${SHARED_SITE_ENV}" "${RELEASE_ROOT}/env/site.env"
}

ensure_operator_registry_env() {
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_REGISTRY_ENV}" ]]; then
    if [[ -f "${OPERATOR_REGISTRY_ENV}" ]]; then
      cp "${OPERATOR_REGISTRY_ENV}" "${SHARED_REGISTRY_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/registry.env" ]]; then
      cp "${RELEASE_ROOT}/env/registry.env" "${SHARED_REGISTRY_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/registry.env.example" ]]; then
      cp "${RELEASE_ROOT}/env/registry.env.example" "${SHARED_REGISTRY_ENV}"
      die "missing registry.env; template copied to ${SHARED_REGISTRY_ENV}"
    else
      die "missing registry.env in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_REGISTRY_ENV}" "${RELEASE_ROOT}/env/registry.env"
}

ensure_operator_kubeconfig() {
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_KUBECONFIG}" ]]; then
    if [[ -f "${OPERATOR_KUBECONFIG}" ]]; then
      cp "${OPERATOR_KUBECONFIG}" "${SHARED_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/kubeconfig" ]]; then
      cp "${RELEASE_ROOT}/env/kubeconfig" "${SHARED_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/kubeconfig.example.yaml" ]]; then
      cp "${RELEASE_ROOT}/env/kubeconfig.example.yaml" "${SHARED_KUBECONFIG}"
      die "missing kubeconfig; template copied to ${SHARED_KUBECONFIG}"
    else
      die "missing kubeconfig in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_KUBECONFIG}" "${RELEASE_ROOT}/env/kubeconfig"
  export KUBECONFIG="${SHARED_KUBECONFIG}"
}

load_registry_env() {
  ensure_operator_registry_env
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* || "${line}" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    export "${key}=${value}"
  done < "${RELEASE_ROOT}/env/registry.env"
}

load_kubeconfig() {
  ensure_operator_kubeconfig
  export KUBECONFIG="${SHARED_KUBECONFIG}"
}
