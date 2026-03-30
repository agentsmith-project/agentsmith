#!/usr/bin/env bash
set -euo pipefail

substrate_up() { write_connection_env; write_status_json; }
substrate_down() { write_status_json; }
substrate_reset() { die "external substrate does not support destructive reset by default"; }
substrate_status() {
  write_status_json
  echo "Substrate: ${SUBSTRATE}"
  echo "Type: ${SUBSTRATE_TYPE}"
  echo "Connection env: ${SUBSTRATE_CONNECTION_ENV}"
}
