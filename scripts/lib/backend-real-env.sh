#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/runtime-config.sh"

load_backend_real_env() {
  local secret_file="${1:-${ROOT_DIR}/.env.backend-real}"
  load_runtime_env_stack "backend-real" "${secret_file}"
}

export_backend_real_endpoint_env() {
  PRESET_ENDPOINT_API_KEY_VALUE="${PRESET_ENDPOINT_API_KEY:-}"
  BACKEND_REAL_MODEL_VALUE="${PRESET_ENDPOINT_MODEL:-deepseek-v4-flash}"
  BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL:-https://api.deepseek.com/anthropic}"
  BACKEND_REAL_OPENAI_BASE_URL_VALUE="${PRESET_OPENAI_ENDPOINT_BASE_URL:-https://api.deepseek.com}"
  export \
    PRESET_ENDPOINT_API_KEY_VALUE \
    BACKEND_REAL_MODEL_VALUE \
    BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE \
    BACKEND_REAL_OPENAI_BASE_URL_VALUE
}
