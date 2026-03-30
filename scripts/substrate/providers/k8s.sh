#!/usr/bin/env bash
set -euo pipefail

substrate_up() { write_connection_env; write_status_json; }
substrate_down() { write_status_json; }
substrate_reset() { die "k8s substrate reset is not implemented yet"; }
substrate_status() {
  write_status_json
  echo "Substrate: ${SUBSTRATE}"
  echo "Type: ${SUBSTRATE_TYPE}"
  echo "Connection env: ${SUBSTRATE_CONNECTION_ENV}"
}
