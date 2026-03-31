#!/usr/bin/env bash
set -euo pipefail

release_app_services() {
  printf '%s\n' api web external-runner
}

release_app_upgrade_services() {
  printf '%s\n' api web external-runner universal-proxy
}

release_app_upgrade_remove_existing() {
  local service cid
  for service in $(release_app_upgrade_services); do
    while IFS= read -r cid; do
      [[ -n "${cid}" ]] || continue
      docker rm -f "${cid}" >/dev/null 2>&1 || true
    done < <(docker ps -aq \
      --filter "label=com.docker.compose.project=agentsmith-cluster" \
      --filter "label=com.docker.compose.service=${service}")
    docker rm -f "agentsmith-cluster-${service}-1" >/dev/null 2>&1 || true
  done
}

release_app_up() {
  docker_compose up -d $(release_app_services)
}

release_app_upgrade_up() {
  release_app_upgrade_remove_existing
  docker_compose up -d --no-deps --force-recreate $(release_app_upgrade_services)
}
