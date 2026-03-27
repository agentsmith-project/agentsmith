#!/usr/bin/env bash
set -euo pipefail

run_deploy_bootstrap() {
  load_release_env

  HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
  HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
  API_BASE="${HOST_LOCAL_API_BASE_URL}"
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}"
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-http://keycloak:8080}"
  DEPLOY_ENDPOINT_API_KEY="${DEPLOY_ENDPOINT_API_KEY:-}"
  DEPLOY_ANTHROPIC_BASE_URL="${DEPLOY_ANTHROPIC_BASE_URL:-https://api.minimaxi.com/anthropic/v1}"
  DEPLOY_OPENAI_BASE_URL="${DEPLOY_OPENAI_BASE_URL:-https://api.minimaxi.com/v1}"
  DEPLOY_ENDPOINT_MODEL="${DEPLOY_ENDPOINT_MODEL:-MiniMax-M2.7-highspeed}"
  DEMO_ENDPOINT_TIMEOUT_SECONDS="${MBOS_DEMO_ENDPOINT_TIMEOUT_SECONDS:-900}"
  DEMO_MODEL_CONTEXT_TOKENS="${MBOS_DEMO_MODEL_CONTEXT_TOKENS:-204800}"
  DEMO_MODEL_MAX_OUTPUT_TOKENS="${MBOS_DEMO_MODEL_MAX_OUTPUT_TOKENS:-8192}"
  RUNNER_IMAGE="${RUNNER_IMAGE:-$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")}"
  INTERNAL_AGENT_IMAGE="${INTERNAL_AGENT_IMAGE:-$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")}"
  PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-http://localhost:3001}"
  DEMO_PROJECT_NAME="${MBOS_DEMO_PROJECT_NAME:-Demo Project}"
  DEMO_CREDENTIAL_NAME="${MBOS_DEMO_CREDENTIAL_NAME:-minimax-shared-key}"
  DEMO_ANTHROPIC_ENDPOINT_NAME="${MBOS_DEMO_ANTHROPIC_ENDPOINT_NAME:-minimax-anthropic-demo}"
  DEMO_OPENAI_ENDPOINT_NAME="${MBOS_DEMO_OPENAI_ENDPOINT_NAME:-minimax-openai-demo}"
  DEMO_EXTERNAL_AGENT_NAME="${MBOS_DEMO_EXTERNAL_AGENT_NAME:-demo-external-agent}"
  DEMO_INTERNAL_AGENT_NAME="${MBOS_DEMO_INTERNAL_AGENT_NAME:-demo-internal-agent}"
  COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agentsmith-remote}"
  EXTERNAL_RUNNER_CONTAINER_NAME="${EXTERNAL_RUNNER_CONTAINER_NAME:-${COMPOSE_PROJECT_NAME}-external-runner-1}"
  EXTERNAL_RUNNER_DEFAULT_NETWORK="${EXTERNAL_RUNNER_DEFAULT_NETWORK:-${COMPOSE_PROJECT_NAME}_default}"

  [[ -n "${DEPLOY_ENDPOINT_API_KEY}" ]] || die "missing DEPLOY_ENDPOINT_API_KEY"

  external_runner_running() {
    docker inspect -f '{{.State.Running}}' "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>/dev/null | grep -q true
  }

  external_runner_current_image() {
    docker inspect -f '{{.Config.Image}}' "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>/dev/null
  }

  external_runner_matches_release_image() {
    local current_image
    current_image="$(external_runner_current_image 2>/dev/null || true)"
    [[ -n "${current_image}" && "${current_image}" == "${RUNNER_IMAGE}" ]]
  }

  external_runner_connected() {
    docker logs "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>&1 | grep -q '\[agent-codex-runner\] connected'
  }

  wait_docker_daemon() {
    local started
    started="$(date +%s)"
    until docker info >/dev/null 2>&1; do
      if (( "$(date +%s)" - started > 120 )); then
        die "docker daemon did not recover after restart"
      fi
      sleep 2
    done
  }

  recreate_compose_services_after_docker_restart() {
    docker_compose up -d postgres mongo redis minio minio-init keycloak universal-proxy api web >/dev/null
    wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
    wait_tcp "127.0.0.1" "${API_PORT:-20000}" 240
  }

  cleanup_replacement_external_runner_containers() {
    local ids
    ids="$(
      docker ps -a \
        --filter "name=_${EXTERNAL_RUNNER_CONTAINER_NAME}$" \
        --format '{{.ID}}' | tr '\n' ' '
    )"
    if [[ -n "${ids// }" ]]; then
      timeout 10 docker rm -f ${ids} >/dev/null 2>&1 || true
    fi
  }

  quarantine_stale_external_runner() {
    local current_image stale_name suffix
    current_image="$(docker inspect -f '{{.Config.Image}}' "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>/dev/null || true)"
    if [[ -z "${current_image}" || "${current_image}" == "${RUNNER_IMAGE}" ]]; then
      return 0
    fi

    suffix="$(date +%s)"
    stale_name="${EXTERNAL_RUNNER_CONTAINER_NAME}-stale-${suffix}"
    log "quarantining stale external-runner container ${EXTERNAL_RUNNER_CONTAINER_NAME}"
    docker update --restart=no "${EXTERNAL_RUNNER_CONTAINER_NAME}" >/dev/null 2>&1 || true
    docker rename "${EXTERNAL_RUNNER_CONTAINER_NAME}" "${stale_name}" >/dev/null
    docker network disconnect -f "${EXTERNAL_RUNNER_DEFAULT_NETWORK}" "${stale_name}" >/dev/null 2>&1 || true
    cleanup_replacement_external_runner_containers
  }

  ensure_external_runner_slot_available() {
    cleanup_replacement_external_runner_containers
    if docker ps -a --format '{{.Names}}' | grep -qx "${EXTERNAL_RUNNER_CONTAINER_NAME}"; then
      quarantine_stale_external_runner
    fi
  }

  run_external_runner_up() {
    local output status
    set +e
    output="$(
      docker run -d \
        --name "${EXTERNAL_RUNNER_CONTAINER_NAME}" \
        --restart unless-stopped \
        --network "${EXTERNAL_RUNNER_DEFAULT_NETWORK}" \
        --privileged \
        --device /dev/fuse:/dev/fuse \
        --security-opt apparmor:unconfined \
        --env-file "${RELEASE_ROOT}/env/base.env" \
        --env-file "${RELEASE_ROOT}/env/runner.env" \
        --env-file "${RELEASE_ROOT}/env/runner-runtime.env" \
        --add-host host.docker.internal:host-gateway \
        "${RUNNER_IMAGE}" 2>&1
    )"
    status=$?
    set -e
    if (( status == 0 )); then
      return 0
    fi

    if grep -q 'did not receive an exit event' <<<"${output}"; then
      log "docker reported a stuck external-runner stop; restarting docker daemon once"
      sudo systemctl restart docker
      wait_docker_daemon
      recreate_compose_services_after_docker_restart
      docker run -d \
        --name "${EXTERNAL_RUNNER_CONTAINER_NAME}" \
        --restart unless-stopped \
        --network "${EXTERNAL_RUNNER_DEFAULT_NETWORK}" \
        --privileged \
        --device /dev/fuse:/dev/fuse \
        --security-opt apparmor:unconfined \
        --env-file "${RELEASE_ROOT}/env/base.env" \
        --env-file "${RELEASE_ROOT}/env/runner.env" \
        --env-file "${RELEASE_ROOT}/env/runner-runtime.env" \
        --add-host host.docker.internal:host-gateway \
        "${RUNNER_IMAGE}" >/dev/null
      return 0
    fi

    printf '%s\n' "${output}" >&2
    return "${status}"
  }

  docker_compose exec -T postgres bash -lc '
    set -euo pipefail
    psql -U "${POSTGRES_USER:-mbos}" -d "${POSTGRES_DB:-mbos}" >/dev/null
  ' < "${RELEASE_ROOT}/postgres-init/projects.sql"

  docker_compose exec -T api bash -lc '
    INTEGRATION_PUBLIC_WEB_BASES="'"${PUBLIC_WEB_BASE_URL}"'" \
    INTERNAL_KEYCLOAK_BASE_URL="'"${INTERNAL_KEYCLOAK_BASE_URL}"'" \
    KEYCLOAK_REALM="mbos" \
    KEYCLOAK_CLIENT_ID="agentsmith" \
    MONGO_URL="mongodb://mbos:mbos_dev_password@mongo:27017/admin" \
    MONGO_DB_NAME="mbos" \
    npx tsx scripts/integration-keycloak-init.ts >/dev/null
  '

  docker_compose exec -T api bash -lc '
    PUBLIC_KEYCLOAK_BASE_URL="'"${PUBLIC_KEYCLOAK_BASE_URL}"'" \
    KEYCLOAK_REALM="mbos" \
    KEYCLOAK_CLIENT_ID="agentsmith" \
    MONGO_URL="mongodb://mbos:mbos_dev_password@mongo:27017/admin" \
    MONGO_DB_NAME="mbos" \
    npx tsx scripts/ensure-default-workspace.ts >/dev/null
  '

  token_resp="$(
    curl -sS "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode 'grant_type=password' \
      --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
      --data-urlencode 'username=dev-admin' \
      --data-urlencode 'password=dev-admin-123' \
      --data-urlencode 'scope=openid profile email'
  )"
  TOKEN="$(printf '%s' "${token_resp}" | json_extract access_token)"

  WORKSPACE_ID="ws_default"
  WORKSPACE_BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}"
  project_list_resp="$(
    curl -sS "${WORKSPACE_BASE}/projects?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  PROJECT_ID="$(printf '%s' "${project_list_resp}" | json_find_named_id "${DEMO_PROJECT_NAME}")"
  if [[ -z "${PROJECT_ID}" ]]; then
    project_resp="$(
      curl -sS -X POST "${WORKSPACE_BASE}/projects" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[1], visibility:\"private\", join_policy:\"approval_required\"}))' "${DEMO_PROJECT_NAME}")"
    )"
    PROJECT_ID="$(printf '%s' "${project_resp}" | json_extract id)"
  fi
  PROJECT_BASE="${WORKSPACE_BASE}/projects/${PROJECT_ID}"

  credential_list_resp="$(
    curl -sS "${PROJECT_BASE}/credentials?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  CREDENTIAL_ID="$(printf '%s' "${credential_list_resp}" | json_find_named_id "${DEMO_CREDENTIAL_NAME}")"
  if [[ -z "${CREDENTIAL_ID}" ]]; then
    credential_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/credentials" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[2], type:\"api_key\", value:process.argv[1]}))' "${DEPLOY_ENDPOINT_API_KEY}" "${DEMO_CREDENTIAL_NAME}")"
    )"
    CREDENTIAL_ID="$(printf '%s' "${credential_resp}" | json_extract id)"
  fi

  endpoint_list_resp="$(
    curl -sS "${PROJECT_BASE}/endpoints?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${DEMO_ANTHROPIC_ENDPOINT_NAME}")"
  if [[ -z "${ANTHROPIC_ENDPOINT_ID}" ]]; then
    anthropic_endpoint_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/endpoints" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[7], protocol:\"anthropic_compatible\", base_url:process.argv[1], model:process.argv[2], credential_ref:process.argv[3], limits:{timeout_seconds:Number(process.argv[4])}, model_profile:{max_context_tokens:Number(process.argv[5]), max_output_tokens:Number(process.argv[6]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' "${DEPLOY_ANTHROPIC_BASE_URL}" "${DEPLOY_ENDPOINT_MODEL}" "${CREDENTIAL_ID}" "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_MODEL_CONTEXT_TOKENS}" "${DEMO_MODEL_MAX_OUTPUT_TOKENS}" "${DEMO_ANTHROPIC_ENDPOINT_NAME}")"
    )"
    ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${anthropic_endpoint_resp}" | json_extract id)"
  fi

  curl -fsS -X PUT "${PROJECT_BASE}/endpoints/${ANTHROPIC_ENDPOINT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({limits:{timeout_seconds:Number(process.argv[1])}, model_profile:{max_context_tokens:Number(process.argv[2]), max_output_tokens:Number(process.argv[3]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_MODEL_CONTEXT_TOKENS}" "${DEMO_MODEL_MAX_OUTPUT_TOKENS}")" >/dev/null

  agent_list_resp="$(
    curl -sS "${PROJECT_BASE}/agents?page=1&page_size=100" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  EXTERNAL_AGENT_ID="$(printf '%s' "${agent_list_resp}" | json_find_named_id "${DEMO_EXTERNAL_AGENT_NAME}")"
  if [[ -z "${EXTERNAL_AGENT_ID}" ]]; then
    external_agent_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/agents" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[3], mode:\"external\", interaction_mode:\"notebook\", execution_preferences:{notebook:{endpoint_id:process.argv[1], wire_api:\"responses\", model:process.argv[2]}}, config:{runner_runtime:\"compose_managed\"}, capabilities:{streaming_completion:true,multimodal_completion:false}}))' "${ANTHROPIC_ENDPOINT_ID}" "${DEPLOY_ENDPOINT_MODEL}" "${DEMO_EXTERNAL_AGENT_NAME}")"
    )"
    EXTERNAL_AGENT_ID="$(printf '%s' "${external_agent_resp}" | json_extract id)"
  fi

  curl -sS -X PATCH "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({config:{runner_runtime:\"compose_managed\"}}))')" >/dev/null

  EXTERNAL_AGENT_KEY="${MBOS_AGENT_KEY:-}"
  if [[ -z "${EXTERNAL_AGENT_KEY}" ]]; then
    external_agent_key_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}/keys" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d '{}'
    )"
    EXTERNAL_AGENT_KEY="$(printf '%s' "${external_agent_key_resp}" | json_extract key)"
  fi

  external_connection_resp="$(
    curl -sS "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}/connection-info" \
      -H "Authorization: Bearer ${TOKEN}"
  )"
  EXTERNAL_AGENT_WS_URL="$(printf '%s' "${external_connection_resp}" | json_extract ws_url)"

  OPENAI_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${DEMO_OPENAI_ENDPOINT_NAME}")"
  if [[ -z "${OPENAI_ENDPOINT_ID}" ]]; then
    openai_endpoint_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/endpoints" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[7], protocol:\"openai_compatible\", base_url:process.argv[1], model:process.argv[2], credential_ref:process.argv[3], limits:{timeout_seconds:Number(process.argv[4])}, model_profile:{max_context_tokens:Number(process.argv[5]), max_output_tokens:Number(process.argv[6]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' "${DEPLOY_OPENAI_BASE_URL}" "${DEPLOY_ENDPOINT_MODEL}" "${CREDENTIAL_ID}" "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_MODEL_CONTEXT_TOKENS}" "${DEMO_MODEL_MAX_OUTPUT_TOKENS}" "${DEMO_OPENAI_ENDPOINT_NAME}")"
    )"
    OPENAI_ENDPOINT_ID="$(printf '%s' "${openai_endpoint_resp}" | json_extract id)"
  fi

  curl -fsS -X PUT "${PROJECT_BASE}/endpoints/${OPENAI_ENDPOINT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({limits:{timeout_seconds:Number(process.argv[1])}, model_profile:{max_context_tokens:Number(process.argv[2]), max_output_tokens:Number(process.argv[3]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_MODEL_CONTEXT_TOKENS}" "${DEMO_MODEL_MAX_OUTPUT_TOKENS}")" >/dev/null

  INTERNAL_AGENT_ID="$(printf '%s' "${agent_list_resp}" | json_find_named_id "${DEMO_INTERNAL_AGENT_NAME}")"
  if [[ -z "${INTERNAL_AGENT_ID}" ]]; then
    internal_agent_resp="$(
      curl -sS -X POST "${PROJECT_BASE}/agents" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[4], mode:\"internal\", interaction_mode:\"notebook\", execution_preferences:{notebook:{endpoint_id:process.argv[1], wire_api:\"responses\", model:process.argv[2]}}, config:{image:process.argv[3], endpoint_id:process.argv[1], cpu_request:\"500m\", cpu_limit:\"2\", memory_request:\"512Mi\", memory_limit:\"4Gi\", idle_timeout_sec:180, max_lifetime_sec:3600}, capabilities:{streaming_completion:true}}))' "${OPENAI_ENDPOINT_ID}" "${DEPLOY_ENDPOINT_MODEL}" "${INTERNAL_AGENT_IMAGE}" "${DEMO_INTERNAL_AGENT_NAME}")"
    )"
    INTERNAL_AGENT_ID="$(printf '%s' "${internal_agent_resp}" | json_extract id)"
  fi

  cat > "${RELEASE_ROOT}/env/runner-runtime.env" <<EOF
# Generated by bootstrap.sh after preset external agent provisioning.
# Operators must not edit this file manually.
MBOS_AGENT_WS_URL=${EXTERNAL_AGENT_WS_URL}
MBOS_AGENT_KEY=${EXTERNAL_AGENT_KEY}
EOF

  if external_runner_running && external_runner_connected && external_runner_matches_release_image; then
    log "checking existing external-runner readiness"
    existing_runner_ready=0
    for _ in $(seq 1 20); do
      if bash "${RELEASE_SCRIPT_DIR}/check-preset-external-file-library.sh" >/dev/null 2>&1; then
        existing_runner_ready=1
        break
      fi
      sleep 3
    done
    if [[ "${existing_runner_ready}" == "1" ]]; then
      log "reusing connected external-runner"
    else
      log "existing external-runner did not recover; recreating"
      timeout 10 docker rm -f "${EXTERNAL_RUNNER_CONTAINER_NAME}" >/dev/null 2>&1 || true
      run_external_runner_up
      started="$(date +%s)"
      until docker logs "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>&1 | grep -q '\[agent-codex-runner\] connected'; do
        if (( "$(date +%s)" - started > 120 )); then
          die "external-runner failed to connect during bootstrap"
        fi
        sleep 2
      done
    fi
  else
    if external_runner_running && ! external_runner_matches_release_image; then
      log "existing external-runner image does not match current release; recreating"
      quarantine_stale_external_runner
      run_external_runner_up
    else
      timeout 10 docker rm -f "${EXTERNAL_RUNNER_CONTAINER_NAME}" >/dev/null 2>&1 || true
      ensure_external_runner_slot_available
      run_external_runner_up
    fi
    started="$(date +%s)"
    until docker logs "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>&1 | grep -q '\[agent-codex-runner\] connected'; do
      if (( "$(date +%s)" - started > 120 )); then
        die "external-runner failed to connect during bootstrap"
      fi
      sleep 2
    done
  fi

  bash "${RELEASE_SCRIPT_DIR}/check-preset-external-file-library.sh"

  state_set release.phase bootstrap_completed
  state_set workspace.id "${WORKSPACE_ID}"
  state_set project.id "${PROJECT_ID}"
  state_set credential.id "${CREDENTIAL_ID}"
  state_set endpoint.primary_id "${ANTHROPIC_ENDPOINT_ID}"
  state_set endpoint.secondary_id "${OPENAI_ENDPOINT_ID}"
  state_set agent.external_id "${EXTERNAL_AGENT_ID}"
  state_set agent.internal_id "${INTERNAL_AGENT_ID}"
  state_set agent.external_runner_connected true
  state_set agent.external_runner_ws_url "${EXTERNAL_AGENT_WS_URL}"

  log "bootstrap ok"
}
