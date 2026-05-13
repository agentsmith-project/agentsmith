#!/usr/bin/env bash

require_runner_kind() {
  local kind="$1"
  case "${kind}" in
    agent-task) ;;
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
  printf '%s/infra/runner/Dockerfile.agent-task-runner-base\n' "${source_root}"
}

runner_app_dockerfile() {
  local kind="$1"
  local source_root="${2:-${ROOT_DIR}}"
  require_runner_kind "${kind}" || return 1
  printf '%s/infra/runner/Dockerfile.agent-task-runner\n' "${source_root}"
}

runner_default_base_image() {
  local kind="$1"
  require_runner_kind "${kind}" || return 1
  printf 'agentsmith-agent-task-runner-base:local\n'
}

runner_default_image() {
  local kind="$1"
  require_runner_kind "${kind}" || return 1
  printf 'agentsmith-agent-task-runner:local\n'
}

runner_release_base_image() {
  local kind="$1"
  local release_id="$2"
  require_runner_kind "${kind}" || return 1
  printf 'agentsmith-agent-task-runner-base:%s\n' "${release_id}"
}

runner_release_image() {
  local kind="$1"
  local release_id="$2"
  local image_prefix="$3"
  require_runner_kind "${kind}" || return 1
  printf '%s/agentsmith-agent-task-runner:%s\n' "${image_prefix}" "${release_id}"
}

runner_default_node_base_image() {
  printf 'public.ecr.aws/docker/library/node:24.14.1-bookworm\n'
}

runner_default_node_base_image_fallbacks() {
  printf 'docker.io/library/node:24.14.1-bookworm mirror.gcr.io/library/node:24.14.1-bookworm\n'
}

runner_node_base_image_candidates() {
  local default_node_base_image primary fallbacks fallback seen
  default_node_base_image="$(runner_default_node_base_image)"
  primary="${RUNNER_NODE_BASE_IMAGE:-${NODE_BASE_IMAGE:-${default_node_base_image}}}"
  printf '%s\n' "${primary}"

  fallbacks="${RUNNER_NODE_BASE_IMAGE_FALLBACKS:-}"
  if [[ -z "${fallbacks}" && "${primary}" == "${default_node_base_image}" ]]; then
    fallbacks="$(runner_default_node_base_image_fallbacks)"
  fi
  if [[ "${fallbacks}" == "0" || "${fallbacks}" == "none" ]]; then
    return 0
  fi

  seen=" ${primary} "
  fallbacks="${fallbacks//,/ }"
  for fallback in ${fallbacks}; do
    if [[ -z "${fallback}" || "${seen}" == *" ${fallback} "* ]]; then
      continue
    fi
    printf '%s\n' "${fallback}"
    seen="${seen}${fallback} "
  done
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
    local base_build_log base_build_status node_base_image attempted_count base_args
    base_build_log="$(mktemp "${TMPDIR:-/tmp}/agentsmith-runner-base-build.XXXXXX.log")"
    base_build_status=1
    attempted_count=0
    while IFS= read -r node_base_image; do
      if [[ -z "${node_base_image}" ]]; then
        continue
      fi
      attempted_count=$((attempted_count + 1))
      base_args=(--build-arg "NODE_BASE_IMAGE=${node_base_image}" -t "${base_image}" -f "${base_dockerfile}" "${source_root}")
      if [[ -n "${docker_build_proxy}" ]]; then
        base_args=(--build-arg "HTTP_PROXY=${docker_build_proxy}" --build-arg "HTTPS_PROXY=${docker_build_proxy}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" --build-arg "NODE_BASE_IMAGE=${node_base_image}" -t "${base_image}" -f "${base_dockerfile}" "${source_root}")
      fi
      if runner_docker_build "${base_args[@]}" >/dev/null 2>"${base_build_log}"; then
        if [[ "${attempted_count}" -gt 1 ]]; then
          printf '[runner-image-common] built %s runner base image with fallback NODE_BASE_IMAGE=%s\n' "${kind}" "${node_base_image}" >&2
        fi
        base_build_status=0
        break
      fi
      base_build_status=1
      if [[ "${attempted_count}" -eq 1 ]]; then
        printf '[runner-image-common] base image build failed for %s with NODE_BASE_IMAGE=%s; retrying configured fallback base images if available.\n' "${kind}" "${node_base_image}" >&2
      else
        printf '[runner-image-common] fallback base image build failed for %s with NODE_BASE_IMAGE=%s.\n' "${kind}" "${node_base_image}" >&2
      fi
      tail -80 "${base_build_log}" >&2 || cat "${base_build_log}" >&2
    done < <(runner_node_base_image_candidates)

    rm -f "${base_build_log}"
    if [[ "${base_build_status}" -ne 0 ]]; then
      return "${base_build_status}"
    fi
  fi

  if [[ "${rebuild_image}" == "1" ]] || ! docker image inspect "${image}" >/dev/null 2>&1; then
    local app_args=(--build-arg "RUNNER_BASE_IMAGE=${base_image}" -t "${image}" -f "${app_dockerfile}" "${source_root}")
    if [[ -n "${docker_build_proxy}" ]]; then
      app_args=(--build-arg "HTTP_PROXY=${docker_build_proxy}" --build-arg "HTTPS_PROXY=${docker_build_proxy}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" --build-arg "RUNNER_BASE_IMAGE=${base_image}" -t "${image}" -f "${app_dockerfile}" "${source_root}")
    fi
    runner_docker_build "${app_args[@]}" >/dev/null
  fi
}
