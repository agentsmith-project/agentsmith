#!/usr/bin/env bash
set -euo pipefail

docker_buildx_require() {
  if ! docker buildx version >/dev/null 2>&1; then
    echo "[docker-buildx] buildx is required. Install docker-buildx first." >&2
    return 1
  fi
}

docker_buildx_ensure_builder() {
  docker_buildx_require
  local builder="${DOCKER_BUILDX_BUILDER:-default}"
  if [[ "${DOCKER_BUILDX_READY:-0}" == "1" && "${DOCKER_BUILDX_BUILDER:-}" == "${builder}" ]]; then
    return 0
  fi
  if ! docker buildx inspect "${builder}" >/dev/null 2>&1; then
    docker buildx create --name "${builder}" --driver docker-container --use >/dev/null
  else
    docker buildx use "${builder}" >/dev/null
  fi
  docker buildx inspect --bootstrap "${builder}" >/dev/null
  export DOCKER_BUILDX_BUILDER="${builder}"
  export DOCKER_BUILDX_READY=1
}

docker_build_local() {
  docker_buildx_ensure_builder
  docker buildx build --builder "${DOCKER_BUILDX_BUILDER}" --load "$@"
}
