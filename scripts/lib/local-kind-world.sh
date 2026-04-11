#!/usr/bin/env bash
set -euo pipefail

resolve_local_kind_bin() {
  if [[ -n "${LOCAL_KIND_BIN:-}" ]]; then
    printf '%s\n' "${LOCAL_KIND_BIN}"
    return 0
  fi
  command -v kind 2>/dev/null || true
}

resolve_local_kind_docker_bin() {
  if [[ -n "${LOCAL_KIND_DOCKER_BIN:-}" ]]; then
    printf '%s\n' "${LOCAL_KIND_DOCKER_BIN}"
    return 0
  fi
  command -v docker 2>/dev/null || true
}

local_kind_cluster_exists() {
  local cluster_name="$1"
  local kind_bin
  kind_bin="$(resolve_local_kind_bin)"
  [[ -n "${kind_bin}" ]] || return 1
  "${kind_bin}" get clusters 2>/dev/null | grep -qx "${cluster_name}"
}

local_kind_registry_exists() {
  local registry_name="$1"
  local docker_bin
  docker_bin="$(resolve_local_kind_docker_bin)"
  [[ -n "${docker_bin}" ]] || return 1
  "${docker_bin}" ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "${registry_name}"
}

local_kind_world_destroy() {
  local cluster_name="$1"
  local registry_name="$2"
  local state_root="$3"
  shift 3
  local extra_paths=("$@")

  local kind_bin
  local docker_bin
  kind_bin="$(resolve_local_kind_bin)"
  docker_bin="$(resolve_local_kind_docker_bin)"

  if [[ -n "${kind_bin}" ]] && local_kind_cluster_exists "${cluster_name}"; then
    "${kind_bin}" delete cluster --name "${cluster_name}" >/dev/null || true
  fi

  if [[ -n "${docker_bin}" ]] && local_kind_registry_exists "${registry_name}"; then
    "${docker_bin}" rm -f "${registry_name}" >/dev/null 2>&1 || true
  fi

  rm -rf "${state_root}"
  local path
  for path in "${extra_paths[@]}"; do
    [[ -n "${path}" ]] || continue
    rm -rf "${path}"
  done
}
