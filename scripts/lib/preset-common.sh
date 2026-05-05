#!/usr/bin/env bash
set -euo pipefail

normalize_endpoint_upstream_protocol() {
  local value="${1:-}"
  case "${value}" in
    openai_chat_completions|openai_responses|anthropic_messages)
      printf '%s\n' "${value}"
      ;;
    openai_compatible|anthropic_compatible)
      echo "[preset-common] unsupported legacy endpoint protocol: ${value}. Use canonical upstream protocol names." >&2
      return 1
      ;;
    *)
      echo "[preset-common] unsupported endpoint protocol: ${value}" >&2
      return 1
      ;;
  esac
}

load_agentsmith_presets() {
  local root_dir="$1"
  local preset_file="${root_dir}/infra/runtime/presets.env"
  local backend_real_file="${root_dir}/.env.backend-real"
  if [[ -f "${preset_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${preset_file}"
    set +a
  fi
  if [[ -f "${backend_real_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${backend_real_file}"
    set +a
  fi
  local key preset_key
  for key in \
    SYSTEM_ADMIN_USERNAME \
    SYSTEM_ADMIN_PASSWORD \
    INTEGRATION_DEV_ADMIN_USERNAME \
    INTEGRATION_DEV_ADMIN_PASSWORD \
    INTEGRATION_USER_USERNAME \
    INTEGRATION_USER_PASSWORD \
    INTEGRATION_MEMBER_USERNAME \
    INTEGRATION_MEMBER_PASSWORD \
    MBOS_DEFAULT_WORKSPACE_ID \
    MBOS_DEFAULT_WORKSPACE_NAME \
    MBOS_DEFAULT_WORKSPACE_ADMIN_EMAIL \
    PRESET_PROJECT_NAME \
    PRESET_CREDENTIAL_NAME \
    PRESET_ANTHROPIC_ENDPOINT_NAME \
    PRESET_OPENAI_ENDPOINT_NAME \
    PRESET_AGENT_RUNNER_NAME \
    PRESET_ENDPOINT_API_KEY \
    PRESET_ENDPOINT_MODEL \
    PRESET_ENDPOINT_MAX_CONTEXT_TOKENS \
    PRESET_ENDPOINT_MAX_OUTPUT_TOKENS \
    PRESET_ENDPOINT_TIMEOUT_SECONDS \
    PRESET_ANTHROPIC_ENDPOINT_BASE_URL \
    PRESET_ANTHROPIC_ENDPOINT_PROTOCOL \
    PRESET_OPENAI_ENDPOINT_BASE_URL \
    PRESET_OPENAI_ENDPOINT_PROTOCOL
  do
    preset_key="AGENTSMITH_PRESET_${key}"
    if [[ -n "${!key:-}" ]]; then
      printf -v "${preset_key}" '%s' "${!key}"
      export "${preset_key}"
    fi
  done
}

apply_non_environment_preset_defaults() {
  local key
  for key in \
    SYSTEM_ADMIN_USERNAME \
    SYSTEM_ADMIN_PASSWORD \
    INTEGRATION_DEV_ADMIN_USERNAME \
    INTEGRATION_DEV_ADMIN_PASSWORD \
    INTEGRATION_USER_USERNAME \
    INTEGRATION_USER_PASSWORD \
    INTEGRATION_MEMBER_USERNAME \
    INTEGRATION_MEMBER_PASSWORD \
    MBOS_DEFAULT_WORKSPACE_ID \
    MBOS_DEFAULT_WORKSPACE_NAME \
    MBOS_DEFAULT_WORKSPACE_ADMIN_EMAIL \
    PRESET_PROJECT_NAME \
    PRESET_CREDENTIAL_NAME \
    PRESET_ANTHROPIC_ENDPOINT_NAME \
    PRESET_OPENAI_ENDPOINT_NAME \
    PRESET_AGENT_RUNNER_NAME
  do
    local preset_key="AGENTSMITH_PRESET_${key}"
    if [[ -z "${!key:-}" && -n "${!preset_key:-}" ]]; then
      printf -v "${key}" '%s' "${!preset_key}"
      export "${key}"
    fi
  done
}

apply_preset_endpoint_defaults() {
  local key preset_key
  for key in \
    PRESET_ENDPOINT_API_KEY \
    PRESET_ENDPOINT_MODEL \
    PRESET_ENDPOINT_MAX_CONTEXT_TOKENS \
    PRESET_ENDPOINT_MAX_OUTPUT_TOKENS \
    PRESET_ENDPOINT_TIMEOUT_SECONDS \
    PRESET_ANTHROPIC_ENDPOINT_BASE_URL \
    PRESET_ANTHROPIC_ENDPOINT_PROTOCOL \
    PRESET_OPENAI_ENDPOINT_BASE_URL \
    PRESET_OPENAI_ENDPOINT_PROTOCOL; do
    preset_key="AGENTSMITH_PRESET_${key}"
    if [[ -z "${!key:-}" && -n "${!preset_key:-}" ]]; then
      printf -v "${key}" '%s' "${!preset_key}"
      export "${key}"
    fi
  done

  if [[ -n "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL:-}" ]]; then
    PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="$(normalize_endpoint_upstream_protocol "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}")"
    export PRESET_ANTHROPIC_ENDPOINT_PROTOCOL
  fi
  if [[ -n "${PRESET_OPENAI_ENDPOINT_PROTOCOL:-}" ]]; then
    PRESET_OPENAI_ENDPOINT_PROTOCOL="$(normalize_endpoint_upstream_protocol "${PRESET_OPENAI_ENDPOINT_PROTOCOL}")"
    export PRESET_OPENAI_ENDPOINT_PROTOCOL
  fi
}
