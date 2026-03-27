#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

load_runtime_mode_defaults() {
  local mode="$1"
  local file="${ROOT_DIR}/infra/runtime/${mode}.env"
  [[ -f "${file}" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
}

load_optional_secret_env() {
  local file="$1"
  [[ -f "${file}" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
}

load_runtime_env_stack() {
  local mode="$1"
  local secret_file="$2"
  load_agentsmith_presets "${ROOT_DIR}"
  load_runtime_mode_defaults "${mode}"
  load_optional_secret_env "${secret_file}"
  apply_non_environment_preset_defaults
  apply_preset_endpoint_defaults
}
