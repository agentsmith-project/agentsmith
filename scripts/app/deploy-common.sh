#!/usr/bin/env bash
set -euo pipefail

release_app_services() {
  printf '%s\n' api web external-runner
}

release_app_up() {
  docker_compose up -d $(release_app_services)
}
