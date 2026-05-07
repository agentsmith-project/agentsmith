#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

run_deploy_bootstrap() {
  load_agentsmith_presets "${ROOT_DIR}"
  load_release_env
  apply_non_environment_preset_defaults
  apply_preset_endpoint_defaults
  runtime_proxy_mode >/dev/null

  HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
  HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
  API_BASE="${HOST_LOCAL_API_BASE_URL}"
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}"
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-http://keycloak:8080}"
  BOOTSTRAP_USERNAME="${BOOTSTRAP_USERNAME:-${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}}"
  BOOTSTRAP_PASSWORD="${BOOTSTRAP_PASSWORD:-${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}}"
  BOOTSTRAP_KEYCLOAK_REALM="${BOOTSTRAP_KEYCLOAK_REALM:-mbos}"
  BOOTSTRAP_KEYCLOAK_CLIENT_ID="${BOOTSTRAP_KEYCLOAK_CLIENT_ID:-agentsmith}"
  BOOTSTRAP_MONGO_URL="${BOOTSTRAP_MONGO_URL:-${MONGO_URL:-}}"
  BOOTSTRAP_MONGO_DB_NAME="${BOOTSTRAP_MONGO_DB_NAME:-${MONGO_DB_NAME:-}}"
  PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY:-}"
  PRESET_ENDPOINT_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}"
  PRESET_ENDPOINT_TIMEOUT_SECONDS="${PRESET_ENDPOINT_TIMEOUT_SECONDS:-900}"
  PRESET_ENDPOINT_MAX_CONTEXT_TOKENS="${PRESET_ENDPOINT_MAX_CONTEXT_TOKENS:-204800}"
  PRESET_ENDPOINT_MAX_OUTPUT_TOKENS="${PRESET_ENDPOINT_MAX_OUTPUT_TOKENS:-128000}"
  PRESET_ANTHROPIC_ENDPOINT_NAME="${PRESET_ANTHROPIC_ENDPOINT_NAME:-preset-anthropic-endpoint}"
  PRESET_ANTHROPIC_ENDPOINT_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL:-https://anthropic-compatible.provider.example/v1}"
  PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL:-anthropic_messages}"
  PRESET_OPENAI_ENDPOINT_NAME="${PRESET_OPENAI_ENDPOINT_NAME:-preset-openai-endpoint}"
  PRESET_OPENAI_ENDPOINT_BASE_URL="${PRESET_OPENAI_ENDPOINT_BASE_URL:-https://openai-compatible.provider.example/v1}"
  PRESET_OPENAI_ENDPOINT_PROTOCOL="${PRESET_OPENAI_ENDPOINT_PROTOCOL:-openai_chat_completions}"
  AGENT_TASK_RUNNER_IMAGE="${AGENT_TASK_RUNNER_IMAGE:-$(awk -F= '$1=="agentsmith_agent_task_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")}"
  PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-http://localhost:3001}"
  KEYCLOAK_REDIRECT_WEB_BASES="${INTEGRATION_PUBLIC_WEB_BASES:-${PUBLIC_WEB_BASE_URL}}"
  PRESET_PROJECT_NAME="${PRESET_PROJECT_NAME:-Demo Project}"
  PRESET_CREDENTIAL_NAME="${PRESET_CREDENTIAL_NAME:-preset-shared-key}"
  PRESET_AGENT_RUNNER_NAME="${PRESET_AGENT_RUNNER_NAME:-demo-agent-task-runner}"

  [[ -n "${PRESET_ENDPOINT_API_KEY}" ]] || die "missing PRESET_ENDPOINT_API_KEY"
  [[ -n "${BOOTSTRAP_MONGO_URL}" ]] || die "missing BOOTSTRAP_MONGO_URL"
  [[ -n "${BOOTSTRAP_MONGO_DB_NAME}" ]] || die "missing BOOTSTRAP_MONGO_DB_NAME"
  [[ -n "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}" ]] || die "missing PRESET_ANTHROPIC_ENDPOINT_BASE_URL"
  [[ -n "${PRESET_OPENAI_ENDPOINT_BASE_URL}" ]] || die "missing PRESET_OPENAI_ENDPOINT_BASE_URL"

  wait_keycloak_admin_token_via_api_container() {
    local started status
    started="$(date +%s)"
    while true; do
      status="$(
        docker_compose exec -T api bash -lc '
          curl -sS -o /tmp/keycloak-admin-token.json -w "%{http_code}" \
            "${INTERNAL_KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token" \
            -H "content-type: application/x-www-form-urlencoded" \
            --data-urlencode "grant_type=password" \
            --data-urlencode "client_id=admin-cli" \
            --data-urlencode "username=${KEYCLOAK_ADMIN}" \
            --data-urlencode "password=${KEYCLOAK_ADMIN_PASSWORD}"
        ' 2>/dev/null || true
      )"
      if [[ "${status}" == "200" ]]; then
        return 0
      fi
      if (( "$(date +%s)" - started > 180 )); then
        die "keycloak admin token did not become ready inside api container"
      fi
      sleep 2
    done
  }

  docker_compose exec -T postgres bash -lc '
    set -euo pipefail
    psql -U "${POSTGRES_USER:-mbos}" -d "${POSTGRES_DB:-mbos}" >/dev/null
  ' < "${RELEASE_ROOT}/postgres-init/projects.sql"

  wait_keycloak_admin_token_via_api_container

  docker_compose exec -T api bash -lc '
    INTEGRATION_PUBLIC_WEB_BASES="'"${KEYCLOAK_REDIRECT_WEB_BASES}"'" \
    INTERNAL_KEYCLOAK_BASE_URL="'"${INTERNAL_KEYCLOAK_BASE_URL}"'" \
    KEYCLOAK_REALM="'"${BOOTSTRAP_KEYCLOAK_REALM}"'" \
    KEYCLOAK_CLIENT_ID="'"${BOOTSTRAP_KEYCLOAK_CLIENT_ID}"'" \
    MONGO_URL="'"${BOOTSTRAP_MONGO_URL}"'" \
    MONGO_DB_NAME="'"${BOOTSTRAP_MONGO_DB_NAME}"'" \
    npx tsx scripts/integration-keycloak-init.ts >/dev/null
  '

  docker_compose exec -T api bash -lc '
    PUBLIC_KEYCLOAK_BASE_URL="'"${PUBLIC_KEYCLOAK_BASE_URL}"'" \
    INTERNAL_KEYCLOAK_BASE_URL="'"${INTERNAL_KEYCLOAK_BASE_URL}"'" \
    KEYCLOAK_REALM="'"${BOOTSTRAP_KEYCLOAK_REALM}"'" \
    KEYCLOAK_CLIENT_ID="'"${BOOTSTRAP_KEYCLOAK_CLIENT_ID}"'" \
    MONGO_URL="'"${BOOTSTRAP_MONGO_URL}"'" \
    MONGO_DB_NAME="'"${BOOTSTRAP_MONGO_DB_NAME}"'" \
    npx tsx scripts/ensure-default-workspace.ts >/dev/null
  '

  token_resp="$(
    curl -sS "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${BOOTSTRAP_KEYCLOAK_REALM}/protocol/openid-connect/token" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode 'grant_type=password' \
      --data-urlencode "client_id=${BOOTSTRAP_KEYCLOAK_CLIENT_ID}" \
      --data-urlencode "username=${BOOTSTRAP_USERNAME}" \
      --data-urlencode "password=${BOOTSTRAP_PASSWORD}" \
      --data-urlencode 'scope=openid profile email'
  )"
  TOKEN="$(printf '%s' "${token_resp}" | json_extract access_token)"

  WORKSPACE_ID="ws_default"
  WORKSPACE_BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}"
  project_list_resp="$(
    curl -sS "${WORKSPACE_BASE}/projects?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  PROJECT_ID="$(printf '%s' "${project_list_resp}" | json_find_named_id "${PRESET_PROJECT_NAME}")"
  if [[ -z "${PROJECT_ID}" ]]; then
    project_resp="$(
      curl -sS -X POST "${WORKSPACE_BASE}/projects" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[1], visibility:"private", join_policy:"approval_required"}))' "${PRESET_PROJECT_NAME}")"
    )"
    PROJECT_ID="$(printf '%s' "${project_resp}" | json_extract id)"
  fi
  PROJECT_BASE="${WORKSPACE_BASE}/projects/${PROJECT_ID}"

  credential_list_resp="$(
    curl -sS "${PROJECT_BASE}/credentials?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  CREDENTIAL_ID="$(printf '%s' "${credential_list_resp}" | json_find_named_id "${PRESET_CREDENTIAL_NAME}")"
  if [[ -z "${CREDENTIAL_ID}" ]]; then
    credential_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/credentials" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[2], type:"api_key", value:process.argv[1]}))' "${PRESET_ENDPOINT_API_KEY}" "${PRESET_CREDENTIAL_NAME}")"
    )"
    CREDENTIAL_ID="$(printf '%s' "${credential_resp}" | json_extract id)"
  else
    curl -fsS -X POST "${PROJECT_BASE}/credentials/${CREDENTIAL_ID}/rotate" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({value:process.argv[1]}))' "${PRESET_ENDPOINT_API_KEY}")" >/dev/null
  fi

  endpoint_payload() {
    docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[1], type:"custom", upstream_protocol:process.argv[2], base_url:process.argv[3], model:process.argv[4], credential_ref:process.argv[5], status:"active", limits:{timeout_seconds:Number(process.argv[6])}, model_profile:{max_context_tokens:Number(process.argv[7]), max_output_tokens:Number(process.argv[8]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' \
      "$1" "$2" "$3" "${PRESET_ENDPOINT_MODEL}" "${CREDENTIAL_ID}" "${PRESET_ENDPOINT_TIMEOUT_SECONDS}" "${PRESET_ENDPOINT_MAX_CONTEXT_TOKENS}" "${PRESET_ENDPOINT_MAX_OUTPUT_TOKENS}"
  }

  json_path_optional() {
    node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); let v=j; for (const p of process.argv[1].split(".")) { if (!p) continue; v=v?.[p]; } if (v == null) process.exit(0); process.stdout.write(String(v)); })' "$1"
  }

  ensure_agent_task_model_setting() {
    local endpoint_id="$1"
    local setting_resp setting_endpoint_id setting_revision setting_readiness patch_resp patched_revision
    setting_resp="$(
      curl -sS "${PROJECT_BASE}/agent-task-model-setting" \
        -H "Authorization: Bearer ${TOKEN}"
    )"
    setting_endpoint_id="$(printf '%s' "${setting_resp}" | json_path_optional setting.endpoint_id)"
    setting_revision="$(printf '%s' "${setting_resp}" | json_path_optional setting.setting_revision)"
    setting_readiness="$(printf '%s' "${setting_resp}" | json_path_optional readiness.state)"
    if [[ "${setting_endpoint_id}" == "${endpoint_id}" && "${setting_readiness}" == "ready" && -n "${setting_revision}" ]]; then
      return 0
    fi

    patch_resp="$(
      curl -sS -X PATCH "${PROJECT_BASE}/agent-task-model-setting" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'const revision = process.argv[2] || null; console.log(JSON.stringify({endpoint_id:process.argv[1], expected_setting_revision:revision}))' "${endpoint_id}" "${setting_revision}")"
    )"
    patched_revision="$(printf '%s' "${patch_resp}" | json_path_optional setting.setting_revision)"
    if [[ -z "${patched_revision}" ]]; then
      die "failed to configure Agent task model setting: ${patch_resp}"
    fi
  }

  endpoint_list_resp="$(
    curl -sS "${PROJECT_BASE}/endpoints?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${PRESET_ANTHROPIC_ENDPOINT_NAME}")"
  if [[ -z "${ANTHROPIC_ENDPOINT_ID}" ]]; then
    anthropic_endpoint_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/endpoints" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(endpoint_payload "${PRESET_ANTHROPIC_ENDPOINT_NAME}" "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}")"
    )"
    ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${anthropic_endpoint_resp}" | json_extract id)"
  fi

  curl -fsS -X PUT "${PROJECT_BASE}/endpoints/${ANTHROPIC_ENDPOINT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(endpoint_payload "${PRESET_ANTHROPIC_ENDPOINT_NAME}" "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}")" >/dev/null

  OPENAI_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${PRESET_OPENAI_ENDPOINT_NAME}")"
  if [[ -z "${OPENAI_ENDPOINT_ID}" ]]; then
    openai_endpoint_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/endpoints" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(endpoint_payload "${PRESET_OPENAI_ENDPOINT_NAME}" "${PRESET_OPENAI_ENDPOINT_PROTOCOL}" "${PRESET_OPENAI_ENDPOINT_BASE_URL}")"
    )"
    OPENAI_ENDPOINT_ID="$(printf '%s' "${openai_endpoint_resp}" | json_extract id)"
  fi

  curl -fsS -X PUT "${PROJECT_BASE}/endpoints/${OPENAI_ENDPOINT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(endpoint_payload "${PRESET_OPENAI_ENDPOINT_NAME}" "${PRESET_OPENAI_ENDPOINT_PROTOCOL}" "${PRESET_OPENAI_ENDPOINT_BASE_URL}")" >/dev/null

  ensure_agent_task_model_setting "${ANTHROPIC_ENDPOINT_ID}"

  runner_list_resp="$(
    curl -sS "${PROJECT_BASE}/agent-runners?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  AGENT_RUNNER_ID="$(printf '%s' "${runner_list_resp}" | json_find_named_id "${PRESET_AGENT_RUNNER_NAME}")"
  runner_payload() {
    docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[1], status:"ready", is_default:true, default_endpoint_id:process.argv[2], description:"Managed Agent task runner baseline", diagnostics:{image:process.argv[3]}, capabilities:{streaming_completion:true,multimodal_completion:false,terminal:true,artifacts:true}}))' \
      "${PRESET_AGENT_RUNNER_NAME}" "${ANTHROPIC_ENDPOINT_ID}" "${AGENT_TASK_RUNNER_IMAGE}"
  }
  if [[ -z "${AGENT_RUNNER_ID}" ]]; then
    runner_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/agent-runners" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(runner_payload)"
    )"
    AGENT_RUNNER_ID="$(printf '%s' "${runner_resp}" | json_extract id)"
  else
    curl -sS -X PATCH "${PROJECT_BASE}/agent-runners/${AGENT_RUNNER_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(runner_payload)" >/dev/null
  fi

  state_set release.phase bootstrap_completed
  state_set workspace.id "${WORKSPACE_ID}"
  state_set project.id "${PROJECT_ID}"
  state_set credential.id "${CREDENTIAL_ID}"
  state_set endpoint.anthropic_id "${ANTHROPIC_ENDPOINT_ID}"
  state_set endpoint.openai_id "${OPENAI_ENDPOINT_ID}"
  state_set agent_runner.id "${AGENT_RUNNER_ID}"
  state_set agent_runner.managed true
}
