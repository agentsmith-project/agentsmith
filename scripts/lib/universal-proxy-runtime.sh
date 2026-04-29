#!/usr/bin/env bash
set -euo pipefail

UNIVERSAL_PROXY_RUNTIME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${UNIVERSAL_PROXY_RUNTIME_LIB_DIR}/llmup-image-lock.sh"

universal_proxy_runtime_prefix() {
  printf '%s' "${UNIVERSAL_PROXY_RUNTIME_LOG_PREFIX:-[universal-proxy-runtime]}"
}

universal_proxy_runtime_info() {
  printf '%s %s\n' "$(universal_proxy_runtime_prefix)" "$*" >&2
}

universal_proxy_runtime_warn() {
  printf '%s WARN: %s\n' "$(universal_proxy_runtime_prefix)" "$*" >&2
}

universal_proxy_runtime_error() {
  printf '%s ERROR: %s\n' "$(universal_proxy_runtime_prefix)" "$*" >&2
}

universal_proxy_runtime_root_dir() {
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_ROOT_DIR:-${ROOT_DIR:-$(pwd)}}"
}

universal_proxy_runtime_state_dir() {
  local root_dir
  root_dir="$(universal_proxy_runtime_root_dir)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_STATE_DIR:-${root_dir}/artifacts/runtime/universal-proxy}"
}

universal_proxy_runtime_container_id_file() {
  local state_dir
  state_dir="$(universal_proxy_runtime_state_dir)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_CONTAINER_ID_FILE:-${state_dir}/container.id}"
}

universal_proxy_runtime_container_metadata_file() {
  local container_id_file
  container_id_file="$(universal_proxy_runtime_container_id_file)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_CONTAINER_METADATA_FILE:-${container_id_file}.meta}"
}

universal_proxy_runtime_admin_token_file() {
  local state_dir
  state_dir="$(universal_proxy_runtime_state_dir)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_ADMIN_TOKEN_FILE:-${state_dir}/admin.token}"
}

universal_proxy_runtime_log_file() {
  local state_dir
  state_dir="$(universal_proxy_runtime_state_dir)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_LOG_FILE:-${state_dir}/docker.log}"
}

universal_proxy_runtime_config_file() {
  local state_dir
  state_dir="$(universal_proxy_runtime_state_dir)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_CONFIG_FILE:-${state_dir}/config.yaml}"
}

universal_proxy_runtime_port() {
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_PORT:-39080}"
}

universal_proxy_runtime_base_url() {
  local port
  port="$(universal_proxy_runtime_port)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_BASE_URL:-http://127.0.0.1:${port}}"
}

universal_proxy_runtime_container_name() {
  local port
  port="$(universal_proxy_runtime_port)"
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_CONTAINER_NAME:-agentsmith-universal-proxy-${port}}"
}

universal_proxy_runtime_runtime_label() {
  printf '%s\n' "${UNIVERSAL_PROXY_RUNTIME_LABEL:-local}"
}

universal_proxy_runtime_admin_url() {
  local base_url="$1"
  printf '%s/admin/state\n' "${base_url%/}"
}

universal_proxy_runtime_configured_admin_token() {
  local token
  token="${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-${UNIVERSAL_PROXY_RUNTIME_ADMIN_TOKEN:-}}"
  token="${token#"${token%%[![:space:]]*}"}"
  token="${token%"${token##*[![:space:]]}"}"
  [[ -n "${token}" ]] || return 1
  printf '%s\n' "${token}"
}

universal_proxy_runtime_saved_admin_token() {
  local token_file token
  token_file="$(universal_proxy_runtime_admin_token_file)"
  [[ -f "${token_file}" ]] || return 1
  token="$(cat "${token_file}" 2>/dev/null || true)"
  token="${token#"${token%%[![:space:]]*}"}"
  token="${token%"${token##*[![:space:]]}"}"
  [[ -n "${token}" ]] || return 1
  printf '%s\n' "${token}"
}

universal_proxy_runtime_probe_admin_token() {
  universal_proxy_runtime_configured_admin_token || universal_proxy_runtime_saved_admin_token
}

universal_proxy_runtime_generate_admin_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi
  printf '%s:%s:%s\n' "$(universal_proxy_runtime_container_name)" "$$" "$(date -u +%s%N 2>/dev/null || date -u +%s)" | sha256sum | awk '{print $1}'
}

universal_proxy_runtime_ensure_managed_admin_token() {
  local token token_file
  if token="$(universal_proxy_runtime_configured_admin_token)"; then
    printf '%s\n' "${token}"
    return 0
  fi
  if token="$(universal_proxy_runtime_saved_admin_token)"; then
    export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${token}"
    printf '%s\n' "${token}"
    return 0
  fi

  token="$(universal_proxy_runtime_generate_admin_token)"
  token_file="$(universal_proxy_runtime_admin_token_file)"
  mkdir -p "$(dirname "${token_file}")"
  (umask 077 && printf '%s\n' "${token}" > "${token_file}")
  export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${token}"
  printf '%s\n' "${token}"
}

universal_proxy_runtime_probe_status() {
  local base_url="$1"
  local admin_token="${2:-}"
  if [[ -z "${admin_token}" ]]; then
    printf '000'
    return 0
  fi
  curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${admin_token}" "$(universal_proxy_runtime_admin_url "${base_url}")" 2>/dev/null || true
}

universal_proxy_runtime_probe_url_with_token() {
  local base_url="$1"
  local admin_token="${2:-}"
  [[ -n "${admin_token}" ]] || return 1
  [[ "$(universal_proxy_runtime_probe_status "${base_url}" "${admin_token}")" == "200" ]]
}

universal_proxy_runtime_probe_url() {
  local base_url="$1"
  local admin_token
  admin_token="$(universal_proxy_runtime_probe_admin_token 2>/dev/null || true)"
  universal_proxy_runtime_probe_url_with_token "${base_url}" "${admin_token}"
}

universal_proxy_runtime_resolve_locked_image() {
  local root_dir lock_path
  root_dir="$(universal_proxy_runtime_root_dir)"
  lock_path="${UNIVERSAL_PROXY_RUNTIME_IMAGE_LOCK:-${LLMUP_IMAGE_LOCK:-${root_dir}/infra/deploy/shared/llmup-image.lock}}"
  resolve_llmup_image_lock "${lock_path}"
  printf '%s\n' "${LLMUP_SOURCE_IMAGE}"
}

universal_proxy_runtime_failure_help() {
  local reason="$1"
  local image_ref="${2:-unknown}"
  local pull_policy="${3:-${UNIVERSAL_PROXY_DOCKER_PULL_POLICY:-missing}}"
  local explicit_url="${MBOS_UNIVERSAL_PROXY_BASE_URL:-}"

  {
    printf '%s universal proxy unavailable: %s\n' "$(universal_proxy_runtime_prefix)" "${reason}"
    printf '%s image_ref=%s\n' "$(universal_proxy_runtime_prefix)" "${image_ref}"
    printf '%s pull_policy=%s\n' "$(universal_proxy_runtime_prefix)" "${pull_policy}"
    if [[ -n "${explicit_url}" ]]; then
      printf '%s explicit_url=%s\n' "$(universal_proxy_runtime_prefix)" "${explicit_url}"
    fi
    printf '%s Fix: ensure Docker is running, network access to GHCR is available, the locked image digest/version exists, set UNIVERSAL_PROXY_DOCKER_PULL_POLICY=never only for preloaded images, or export MBOS_UNIVERSAL_PROXY_BASE_URL to a reachable universal proxy.\n' "$(universal_proxy_runtime_prefix)"
  } >&2
}

universal_proxy_runtime_wait_for_url() {
  local base_url="$1"
  local timeout_seconds="${2:-60}"
  local start
  start="$(date +%s)"
  while true; do
    if universal_proxy_runtime_probe_url "${base_url}"; then
      return 0
    fi
    if (( "$(date +%s)" - start >= timeout_seconds )); then
      return 1
    fi
    sleep 1
  done
}

universal_proxy_runtime_write_config() {
  local config_file source_config root_dir
  config_file="$(universal_proxy_runtime_config_file)"
  root_dir="$(universal_proxy_runtime_root_dir)"
  source_config="${UNIVERSAL_PROXY_RUNTIME_CONFIG_SOURCE:-${root_dir}/infra/deploy/shared/universal-proxy/config.yaml}"
  mkdir -p "$(dirname "${config_file}")"

  if [[ -f "${source_config}" && "${source_config}" != "${config_file}" ]]; then
    cp "${source_config}" "${config_file}"
    return 0
  fi
  if [[ -f "${config_file}" ]]; then
    return 0
  fi

  cat > "${config_file}" <<'EOF_CONFIG'
listen: 0.0.0.0:8080
upstream_timeout_secs: 120
data_auth:
  mode: client_provider_key
upstreams: {}
model_aliases: {}
EOF_CONFIG
}

universal_proxy_runtime_read_recorded_label() {
  local metadata_file runtime_label
  metadata_file="$(universal_proxy_runtime_container_metadata_file)"
  [[ -f "${metadata_file}" ]] || return 1
  runtime_label="$(awk -F= '$1 == "runtime_label" { print substr($0, index($0, $2)); exit }' "${metadata_file}" 2>/dev/null || true)"
  [[ -n "${runtime_label}" ]] || return 1
  printf '%s\n' "${runtime_label}"
}

universal_proxy_runtime_expected_cleanup_label() {
  local runtime_label
  if [[ -n "${UNIVERSAL_PROXY_RUNTIME_LABEL:-}" ]]; then
    universal_proxy_runtime_runtime_label
    return 0
  fi
  if runtime_label="$(universal_proxy_runtime_read_recorded_label)"; then
    printf '%s\n' "${runtime_label}"
    return 0
  fi
  universal_proxy_runtime_runtime_label
}

universal_proxy_runtime_write_container_record() {
  local container_id="$1"
  local container_name="$2"
  local runtime_label="$3"
  local container_id_file metadata_file
  container_id_file="$(universal_proxy_runtime_container_id_file)"
  metadata_file="$(universal_proxy_runtime_container_metadata_file)"
  mkdir -p "$(dirname "${container_id_file}")" "$(dirname "${metadata_file}")"
  printf '%s\n' "${container_id}" > "${container_id_file}"
  cat > "${metadata_file}" <<EOF_METADATA
runtime_label=${runtime_label}
container_name=${container_name}
EOF_METADATA
}

universal_proxy_runtime_clear_container_record() {
  rm -f "$(universal_proxy_runtime_container_id_file)" "$(universal_proxy_runtime_container_metadata_file)"
}

universal_proxy_runtime_container_label_value() {
  local container_ref="$1"
  local label_key="$2"
  local raw_value
  if ! raw_value="$(docker container inspect --format "{{ index .Config.Labels \"${label_key}\" }}" "${container_ref}" 2>/dev/null)"; then
    return 1
  fi
  raw_value="${raw_value%%$'\n'*}"
  if [[ "${raw_value}" == "<no value>" ]]; then
    raw_value=""
  fi
  printf '%s\n' "${raw_value}"
}

universal_proxy_runtime_check_container_ownership() {
  local container_ref="$1"
  local expected_runtime_label="$2"
  local managed_by runtime_label

  if ! managed_by="$(universal_proxy_runtime_container_label_value "${container_ref}" "com.agentsmith.managed-by")"; then
    return 2
  fi
  if ! runtime_label="$(universal_proxy_runtime_container_label_value "${container_ref}" "com.agentsmith.runtime-label")"; then
    return 2
  fi

  if [[ "${managed_by}" == "universal-proxy-runtime" && "${runtime_label}" == "${expected_runtime_label}" ]]; then
    return 0
  fi

  universal_proxy_runtime_warn "container ${container_ref} is not owned by this runtime (managed-by=${managed_by:-<missing>}, runtime-label=${runtime_label:-<missing>}, expected-runtime-label=${expected_runtime_label})"
  return 1
}

universal_proxy_runtime_remove_owned_container() {
  local container_ref="$1"
  local expected_runtime_label="$2"
  local context="$3"
  local ownership_status

  if universal_proxy_runtime_check_container_ownership "${container_ref}" "${expected_runtime_label}"; then
    if docker rm -f "${container_ref}" >/dev/null 2>&1; then
      return 0
    fi
    universal_proxy_runtime_warn "failed to remove ${context} ${container_ref}"
    return 4
  else
    ownership_status=$?
  fi

  if [[ "${ownership_status}" -eq 2 ]]; then
    universal_proxy_runtime_warn "could not verify ownership for ${context} ${container_ref}"
  fi
  return "${ownership_status}"
}

universal_proxy_runtime_container_id_for_name() {
  local container_name="$1"
  local output
  output="$(docker ps -a --filter "name=^/${container_name}$" --format '{{.ID}}' 2>/dev/null || true)"
  output="${output%%$'\n'*}"
  printf '%s\n' "${output}"
}

universal_proxy_runtime_container_ref_exists() {
  local container_ref="$1"
  local output
  if ! output="$(docker ps -a --filter "id=${container_ref}" --format '{{.ID}}' 2>/dev/null)"; then
    return 2
  fi

  if printf '%s\n' "${output}" | awk -v ref="${container_ref}" 'NF && ($1 == ref || index(ref, $1) == 1 || index($1, ref) == 1) { found = 1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi
  return 1
}

universal_proxy_runtime_reconcile_container_name() {
  local container_name="$1"
  local runtime_label="$2"
  local existing_container_id ownership_status

  existing_container_id="$(universal_proxy_runtime_container_id_for_name "${container_name}")"
  [[ -n "${existing_container_id}" ]] || return 0

  if universal_proxy_runtime_check_container_ownership "${existing_container_id}" "${runtime_label}"; then
    universal_proxy_runtime_info "removing existing managed universal proxy container ${existing_container_id} with name ${container_name}"
    if docker rm -f "${existing_container_id}" >/dev/null 2>&1; then
      return 0
    fi
    universal_proxy_runtime_error "failed to remove existing managed universal proxy container ${existing_container_id} (${container_name}); refusing to start replacement"
    return 1
  else
    ownership_status=$?
  fi

  if [[ "${ownership_status}" -eq 2 ]]; then
    universal_proxy_runtime_error "container name conflict: ${container_name} already exists as ${existing_container_id}, but ownership could not be verified; refusing to remove it"
  else
    universal_proxy_runtime_error "container name conflict: ${container_name} is already used by container ${existing_container_id} that is not managed by this helper; refusing to remove it"
  fi
  return 1
}

universal_proxy_runtime_cleanup_managed_container() {
  local container_id_file container_id expected_runtime_label remove_status container_exists_status
  container_id_file="$(universal_proxy_runtime_container_id_file)"
  [[ -f "${container_id_file}" ]] || return 0

  container_id="$(cat "${container_id_file}" 2>/dev/null || true)"
  if [[ -z "${container_id}" ]]; then
    universal_proxy_runtime_clear_container_record
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    universal_proxy_runtime_warn "docker is unavailable while cleaning recorded container ${container_id}; retaining container id for retry"
    return 0
  fi

  expected_runtime_label="$(universal_proxy_runtime_expected_cleanup_label)"
  if universal_proxy_runtime_remove_owned_container "${container_id}" "${expected_runtime_label}" "recorded container"; then
    universal_proxy_runtime_clear_container_record
    return 0
  else
    remove_status=$?
  fi

  case "${remove_status}" in
    1)
      universal_proxy_runtime_warn "retaining recorded container id ${container_id} because ownership did not match"
      ;;
    2)
      if universal_proxy_runtime_container_ref_exists "${container_id}"; then
        container_exists_status=0
      else
        container_exists_status=$?
      fi
      if [[ "${container_exists_status}" -eq 1 ]]; then
        universal_proxy_runtime_warn "stale recorded container ${container_id} no longer exists; clearing local container record"
        universal_proxy_runtime_clear_container_record
        return 0
      fi
      universal_proxy_runtime_warn "retaining recorded container id ${container_id} because ownership could not be verified"
      ;;
    *)
      universal_proxy_runtime_warn "retaining recorded container id ${container_id} so cleanup can be retried"
      ;;
  esac
  return 0
}

universal_proxy_runtime_pull_image() {
  local image_ref="$1"
  local pull_policy="${UNIVERSAL_PROXY_DOCKER_PULL_POLICY:-missing}"

  case "${pull_policy}" in
    always)
      if ! docker pull "${image_ref}"; then
        universal_proxy_runtime_failure_help "docker pull failed" "${image_ref}" "${pull_policy}"
        return 1
      fi
      ;;
    missing)
      if ! docker image inspect "${image_ref}" >/dev/null 2>&1; then
        if ! docker pull "${image_ref}"; then
          universal_proxy_runtime_failure_help "docker pull failed" "${image_ref}" "${pull_policy}"
          return 1
        fi
      fi
      ;;
    never)
      ;;
    *)
      universal_proxy_runtime_failure_help "invalid UNIVERSAL_PROXY_DOCKER_PULL_POLICY=${pull_policy}" "${image_ref}" "${pull_policy}"
      return 1
      ;;
  esac
}

universal_proxy_runtime_start_managed_container() {
  local image_ref="$1"
  local state_dir config_file container_id_file log_file run_error_file container_name runtime_label admin_token port base_url pull_policy timeout_seconds container_id
  state_dir="$(universal_proxy_runtime_state_dir)"
  config_file="$(universal_proxy_runtime_config_file)"
  container_id_file="$(universal_proxy_runtime_container_id_file)"
  log_file="$(universal_proxy_runtime_log_file)"
  run_error_file="${state_dir}/docker-run.stderr.log"
  container_name="$(universal_proxy_runtime_container_name)"
  runtime_label="$(universal_proxy_runtime_runtime_label)"
  admin_token="$(universal_proxy_runtime_ensure_managed_admin_token)"
  port="$(universal_proxy_runtime_port)"
  base_url="$(universal_proxy_runtime_base_url)"
  pull_policy="${UNIVERSAL_PROXY_DOCKER_PULL_POLICY:-missing}"
  timeout_seconds="${UNIVERSAL_PROXY_RUNTIME_WAIT_TIMEOUT_SECONDS:-60}"

  mkdir -p "${state_dir}" "$(dirname "${log_file}")"
  universal_proxy_runtime_write_config
  universal_proxy_runtime_cleanup_managed_container

  if ! command -v docker >/dev/null 2>&1; then
    universal_proxy_runtime_failure_help "docker command is not available" "${image_ref}" "${pull_policy}"
    return 1
  fi
  if ! universal_proxy_runtime_reconcile_container_name "${container_name}" "${runtime_label}"; then
    return 1
  fi
  if ! universal_proxy_runtime_pull_image "${image_ref}"; then
    return 1
  fi

  if ! container_id="$(
    docker run \
      --pull=never \
      -d \
      --name "${container_name}" \
      --label com.agentsmith.managed-by=universal-proxy-runtime \
      --label "com.agentsmith.runtime-label=${runtime_label}" \
      -p "127.0.0.1:${port}:8080" \
      -v "${config_file}:/app/config/config.yaml:ro" \
      -e LLM_UNIVERSAL_PROXY_AUTH_MODE=client_provider_key \
      -e "LLM_UNIVERSAL_PROXY_ADMIN_TOKEN=${admin_token}" \
      "${image_ref}" \
      --config /app/config/config.yaml 2>"${run_error_file}"
  )"; then
    cat "${run_error_file}" >> "${log_file}" 2>/dev/null || true
    if [[ -s "${run_error_file}" ]]; then
      universal_proxy_runtime_warn "docker run stderr saved to ${run_error_file}"
      while IFS= read -r line; do
        printf '%s docker-run: %s\n' "$(universal_proxy_runtime_prefix)" "${line}" >&2
      done < <(tail -n 20 "${run_error_file}" 2>/dev/null || true)
    fi
    universal_proxy_runtime_failure_help "docker run failed" "${image_ref}" "${pull_policy}"
    return 1
  fi

  universal_proxy_runtime_write_container_record "${container_id}" "${container_name}" "${runtime_label}"
  universal_proxy_runtime_info "started managed universal proxy container ${container_id} (${image_ref})"

  if ! universal_proxy_runtime_wait_for_url "${base_url}" "${timeout_seconds}"; then
    docker logs "${container_id}" >> "${log_file}" 2>&1 || true
    universal_proxy_runtime_cleanup_managed_container
    universal_proxy_runtime_failure_help "managed container did not become ready at ${base_url}" "${image_ref}" "${pull_policy}"
    return 1
  fi

  export MBOS_UNIVERSAL_PROXY_BASE_URL="${base_url}"
  export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${admin_token}"
  universal_proxy_runtime_info "universal proxy ready at ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
}

universal_proxy_runtime_ensure() {
  local explicit_url explicit_admin_token explicit_probe_status candidate default_urls image_ref

  explicit_url="${MBOS_UNIVERSAL_PROXY_BASE_URL:-}"
  if [[ -n "${explicit_url}" ]]; then
    explicit_admin_token="$(universal_proxy_runtime_configured_admin_token 2>/dev/null || true)"
    if [[ -z "${explicit_admin_token}" ]]; then
      universal_proxy_runtime_failure_help "explicit MBOS_UNIVERSAL_PROXY_BASE_URL requires MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN for admin bearer probes" "not-used-for-explicit-url"
      return 1
    fi
    if universal_proxy_runtime_probe_url_with_token "${explicit_url}" "${explicit_admin_token}"; then
      export MBOS_UNIVERSAL_PROXY_BASE_URL="${explicit_url%/}"
      universal_proxy_runtime_info "using explicit universal proxy URL ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
      return 0
    fi
    explicit_probe_status="$(universal_proxy_runtime_probe_status "${explicit_url}" "${explicit_admin_token}")"
    if [[ "${explicit_probe_status}" == "403" ]]; then
      universal_proxy_runtime_failure_help "explicit MBOS_UNIVERSAL_PROXY_BASE_URL admin endpoint rejected MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN" "not-used-for-explicit-url"
      return 1
    fi
    universal_proxy_runtime_failure_help "explicit MBOS_UNIVERSAL_PROXY_BASE_URL is not reachable" "not-used-for-explicit-url"
    return 1
  fi

  default_urls="${UNIVERSAL_PROXY_RUNTIME_DEFAULT_URLS:-$(universal_proxy_runtime_base_url)}"
  for candidate in ${default_urls}; do
    if universal_proxy_runtime_probe_url "${candidate}"; then
      export MBOS_UNIVERSAL_PROXY_BASE_URL="${candidate%/}"
      universal_proxy_runtime_info "reusing reachable universal proxy URL ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
      return 0
    fi
  done

  image_ref="$(universal_proxy_runtime_resolve_locked_image)"
  universal_proxy_runtime_start_managed_container "${image_ref}"
}
