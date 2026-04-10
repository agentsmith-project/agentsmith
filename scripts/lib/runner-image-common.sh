#!/usr/bin/env bash

require_runner_kind() {
  local kind="$1"
  case "${kind}" in
    notebook|chat) ;;
    *)
      echo "[runner-image-common] unsupported runner kind: ${kind}" >&2
      return 1
      ;;
  esac
}

runner_base_dockerfile() {
  local kind="$1"
  local source_root="${2:-${ROOT_DIR}}"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf '%s/infra/runner/Dockerfile.notebook-codex-runner-base\n' "${source_root}" ;;
    chat) printf '%s/infra/runner/Dockerfile.chat-llm-runner-base\n' "${source_root}" ;;
  esac
}

runner_app_dockerfile() {
  local kind="$1"
  local source_root="${2:-${ROOT_DIR}}"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf '%s/infra/runner/Dockerfile.notebook-codex-runner\n' "${source_root}" ;;
    chat) printf '%s/infra/runner/Dockerfile.chat-llm-runner\n' "${source_root}" ;;
  esac
}

runner_default_base_image() {
  local kind="$1"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf 'agentsmith-notebook-codex-runner-base:local\n' ;;
    chat) printf 'agentsmith-chat-llm-runner-base:local\n' ;;
  esac
}

runner_default_image() {
  local kind="$1"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf 'agentsmith-notebook-codex-runner:local\n' ;;
    chat) printf 'agentsmith-chat-llm-runner:local\n' ;;
  esac
}

runner_release_base_image() {
  local kind="$1"
  local release_id="$2"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf 'agentsmith-notebook-codex-runner-base:%s\n' "${release_id}" ;;
    chat) printf 'agentsmith-chat-llm-runner-base:%s\n' "${release_id}" ;;
  esac
}

runner_release_image() {
  local kind="$1"
  local release_id="$2"
  local image_prefix="$3"
  require_runner_kind "${kind}" || return 1
  case "${kind}" in
    notebook) printf '%s/agentsmith-notebook-codex-runner:%s\n' "${image_prefix}" "${release_id}" ;;
    chat) printf '%s/agentsmith-chat-llm-runner:%s\n' "${image_prefix}" "${release_id}" ;;
  esac
}

build_runner_image() {
  local kind="$1"
  local base_image="$2"
  local image="$3"
  local docker_build_proxy="${4:-}"
  local build_base="${5:-1}"
  local rebuild_image="${6:-1}"
  local source_root="${7:-${ROOT_DIR}}"
  local base_dockerfile app_dockerfile
  base_dockerfile="$(runner_base_dockerfile "${kind}" "${source_root}")" || return 1
  app_dockerfile="$(runner_app_dockerfile "${kind}" "${source_root}")" || return 1

  runner_docker_build() {
    if declare -F docker_build_local >/dev/null 2>&1; then
      docker_build_local "$@"
    else
      docker build "$@"
    fi
  }

  if [[ "${build_base}" == "1" ]] || ! docker image inspect "${base_image}" >/dev/null 2>&1; then
    local base_args=(-t "${base_image}" -f "${base_dockerfile}" "${source_root}")
    if [[ -n "${docker_build_proxy}" ]]; then
      base_args=(--build-arg "HTTP_PROXY=${docker_build_proxy}" --build-arg "HTTPS_PROXY=${docker_build_proxy}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" -t "${base_image}" -f "${base_dockerfile}" "${source_root}")
    fi
    runner_docker_build "${base_args[@]}" >/dev/null
  fi

  if [[ "${rebuild_image}" == "1" ]] || ! docker image inspect "${image}" >/dev/null 2>&1; then
    local app_args=(--build-arg "RUNNER_BASE_IMAGE=${base_image}" -t "${image}" -f "${app_dockerfile}" "${source_root}")
    if [[ -n "${docker_build_proxy}" ]]; then
      app_args=(--build-arg "HTTP_PROXY=${docker_build_proxy}" --build-arg "HTTPS_PROXY=${docker_build_proxy}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" --build-arg "RUNNER_BASE_IMAGE=${base_image}" -t "${image}" -f "${app_dockerfile}" "${source_root}")
    fi
    runner_docker_build "${app_args[@]}" >/dev/null
  fi
}
