#!/usr/bin/env bash
set -euo pipefail

release_app_services() {
  printf '%s\n' api web
}

release_app_upgrade_services() {
  printf '%s\n' api web universal-proxy
}

release_compose_project_name() {
  printf '%s\n' "${COMPOSE_PROJECT_NAME:-}"
}

release_remove_compose_service_containers() {
  local project_name="$1"
  shift
  local service cid

  [[ -n "${project_name}" ]] || return 0

  for service in "$@"; do
    while IFS= read -r cid; do
      [[ -n "${cid}" ]] || continue
      docker rm -f "${cid}" >/dev/null 2>&1 || true
    done < <(
      docker ps -aq \
        --filter "label=com.docker.compose.project=${project_name}" \
        --filter "label=com.docker.compose.service=${service}"
    )
    docker rm -f "${project_name}-${service}-1" >/dev/null 2>&1 || true
  done
}

release_app_remove_existing() {
  release_remove_compose_service_containers "$(release_compose_project_name)" $(release_app_services)
}

release_app_upgrade_remove_existing() {
  release_remove_compose_service_containers "$(release_compose_project_name)" $(release_app_upgrade_services)
}

release_app_up() {
  release_app_remove_existing
  docker_compose up -d $(release_app_services)
}

release_app_upgrade_up() {
  release_app_upgrade_remove_existing
  docker_compose up -d --no-deps --force-recreate $(release_app_upgrade_services)
}
