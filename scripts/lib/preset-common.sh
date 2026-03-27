#!/usr/bin/env bash
set -euo pipefail

load_agentsmith_presets() {
  local root_dir="$1"
  local preset_file="${root_dir}/infra/deploy/shared/presets/defaults.env"
  [[ -f "${preset_file}" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "${preset_file}"
  set +a
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
    PRESET_PRIMARY_ENDPOINT_NAME \
    PRESET_SECONDARY_ENDPOINT_NAME \
    PRESET_EXTERNAL_AGENT_NAME \
    PRESET_INTERNAL_AGENT_NAME \
    PRESET_ENDPOINT_API_KEY \
    PRESET_ENDPOINT_BASE_URL \
    PRESET_ENDPOINT_PROTOCOL \
    PRESET_ENDPOINT_MODEL \
    PRESET_ENDPOINT_MAX_CONTEXT_TOKENS \
    PRESET_ENDPOINT_MAX_OUTPUT_TOKENS \
    PRESET_ENDPOINT_TIMEOUT_SECONDS
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
    PRESET_PRIMARY_ENDPOINT_NAME \
    PRESET_SECONDARY_ENDPOINT_NAME \
    PRESET_EXTERNAL_AGENT_NAME \
    PRESET_INTERNAL_AGENT_NAME
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
    PRESET_ENDPOINT_BASE_URL \
    PRESET_ENDPOINT_PROTOCOL \
    PRESET_ENDPOINT_MODEL \
    PRESET_ENDPOINT_MAX_CONTEXT_TOKENS \
    PRESET_ENDPOINT_MAX_OUTPUT_TOKENS \
    PRESET_ENDPOINT_TIMEOUT_SECONDS; do
    preset_key="AGENTSMITH_PRESET_${key}"
    if [[ -z "${!key:-}" && -n "${!preset_key:-}" ]]; then
      printf -v "${key}" '%s' "${!preset_key}"
      export "${key}"
    fi
  done
}
