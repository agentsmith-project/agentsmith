#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "${ROOT_DIR}/scripts/scenarios/common.sh"
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

DEMO_REHEARSAL_NAME="demo-rehearsal"
DEMO_REHEARSAL_ROOT_DEFAULT="${ROOT_DIR}/artifacts/runtime/scenario/${DEMO_REHEARSAL_NAME}"
DEMO_REHEARSAL_ROOT="${DEMO_REHEARSAL_ROOT:-${DEMO_REHEARSAL_ROOT_DEFAULT}}"
DEMO_REHEARSAL_RELEASES_DIR="${DEMO_REHEARSAL_ROOT}/releases"
DEMO_REHEARSAL_CURRENT_LINK="${DEMO_REHEARSAL_ROOT}/current"
DEMO_REHEARSAL_CONFIG_DIR="${DEMO_REHEARSAL_ROOT}/config"
DEMO_REHEARSAL_KIND_CONFIG_PATH="${DEMO_REHEARSAL_KIND_CONFIG_PATH:-${DEMO_REHEARSAL_CONFIG_DIR}/kind-config.yaml}"
DEMO_REHEARSAL_KUBECONFIG="${DEMO_REHEARSAL_KUBECONFIG:-}"

apply_demo_rehearsal_fast_path_env() {
  if [[ -z "${SKIP_BUNDLED_IMAGE_LOAD:-}" && -n "${DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD:-}" ]]; then
    export SKIP_BUNDLED_IMAGE_LOAD="${DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD}"
  fi
}

init_demo_rehearsal_env() {
  load_flow_env "${DEMO_REHEARSAL_NAME}"
  apply_demo_rehearsal_fast_path_env
  if [[ -z "${DEMO_REHEARSAL_KUBECONFIG:-}" ]]; then
    DEMO_REHEARSAL_KUBECONFIG="${DEMO_REHEARSAL_CONFIG_DIR}/$(scenario_kind_context_name).kubeconfig"
  fi
  mkdir -p "${DEMO_REHEARSAL_ROOT}" "${DEMO_REHEARSAL_RELEASES_DIR}" "${DEMO_REHEARSAL_CONFIG_DIR}" "$(dirname "${DEMO_REHEARSAL_KUBECONFIG}")" "$(dirname "${DEMO_REHEARSAL_KIND_CONFIG_PATH}")"
  export ROOT_DIR
  export DEMO_DEPLOY_ROOT="${DEMO_REHEARSAL_ROOT}"
  export KUBECONFIG="${DEMO_REHEARSAL_KUBECONFIG}"
  export LOCAL_KIND_CONFIG_PATH="${DEMO_REHEARSAL_KIND_CONFIG_PATH}"
  if [[ -e "${DEMO_REHEARSAL_CURRENT_LINK}" ]]; then
    export RELEASE_ROOT="$(cd -P "${DEMO_REHEARSAL_CURRENT_LINK}" && pwd)"
  else
    export RELEASE_ROOT="${ROOT_DIR}"
  fi
}

render_demo_rehearsal_kind_config() {
  local sandbox_host_port="${DEMO_REHEARSAL_SANDBOX_HOST_PORT:-}"
  [[ -n "${sandbox_host_port}" ]] || return 0
  render_scenario_owned_kind_config \
    "${ROOT_DIR}/infra/deploy/demo/kind/config.yaml" \
    "${DEMO_REHEARSAL_KIND_CONFIG_PATH}" \
    "$(scenario_kind_cluster_name)" \
    "${sandbox_host_port}"
}

ensure_demo_rehearsal_site_env() {
  local site_env="${DEMO_REHEARSAL_CONFIG_DIR}/site.env"
  if [[ ! -f "${site_env}" ]]; then
    cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${site_env}"
  fi
  apply_flow_site_env_overrides "${site_env}"
  render_demo_rehearsal_kind_config
  hydrate_demo_rehearsal_site_env_secrets "${site_env}"
  validate_demo_rehearsal_site_env "${site_env}"
}

hydrate_demo_rehearsal_site_env_secrets() {
  local site_env="$1"
  local current_value resolved_value

  ensure_scenario_site_env_proxy_admin_token "${site_env}" "${DEMO_REHEARSAL_NAME}"

  current_value="$(site_env_value "${site_env}" PRESET_ENDPOINT_API_KEY)"
  if [[ -n "${current_value}" ]]; then
    return 0
  fi

  load_agentsmith_presets "${ROOT_DIR}"
  apply_preset_endpoint_defaults
  resolved_value="${PRESET_ENDPOINT_API_KEY:-}"
  if [[ -z "${resolved_value}" ]]; then
    return 0
  fi

  write_site_env_value "${site_env}" PRESET_ENDPOINT_API_KEY "${resolved_value}"
}

validate_demo_rehearsal_site_env() {
  local site_env="$1"
  local anthropic_protocol
  local openai_protocol

  anthropic_protocol="$(awk -F= '$1=="PRESET_ANTHROPIC_ENDPOINT_PROTOCOL"{print $2}' "${site_env}" | tail -n1 | tr -d "\"'[:space:]")"
  openai_protocol="$(awk -F= '$1=="PRESET_OPENAI_ENDPOINT_PROTOCOL"{print $2}' "${site_env}" | tail -n1 | tr -d "\"'[:space:]")"

  if [[ -n "${anthropic_protocol}" ]]; then
    normalize_endpoint_upstream_protocol "${anthropic_protocol}" >/dev/null || return 1
  fi
  if [[ -n "${openai_protocol}" ]]; then
    normalize_endpoint_upstream_protocol "${openai_protocol}" >/dev/null || return 1
  fi
}

ensure_demo_rehearsal_release_bundle() {
  local release_id="demo-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
  local skip_release_archive="${SKIP_RELEASE_ARCHIVE:-${DEMO_REHEARSAL_SKIP_RELEASE_ARCHIVE:-}}"
  OUT_DIR="${DEMO_REHEARSAL_RELEASES_DIR}" \
    RELEASE_ID="${release_id}" \
    SKIP_RELEASE_PRECHECK=1 \
    SKIP_RELEASE_ARCHIVE="${skip_release_archive}" \
    bash "${ROOT_DIR}/scripts/demo-deploy/build-offline-bundle.sh"
  export RELEASE_ROOT="${DEMO_REHEARSAL_RELEASES_DIR}/agentsmith-${release_id}"
  sync_demo_rehearsal_release_site_env
}

sync_demo_rehearsal_release_site_env() {
  local scenario_site_env="${DEMO_REHEARSAL_CONFIG_DIR}/site.env"
  [[ -f "${scenario_site_env}" ]] || return 0
  mkdir -p "${RELEASE_ROOT}/env"
  cp "${scenario_site_env}" "${RELEASE_ROOT}/env/site.env"
}

demo_state_file() {
  printf '%s/state/deploy-state.json\n' "${DEMO_REHEARSAL_ROOT}"
}

demo_state_value() {
  local key="$1"
  local file
  file="$(demo_state_file)"
  [[ -f "${file}" ]] || return 0
  python3 - <<'PY' "${file}" "${key}"
import json
import pathlib
import sys

file_path = pathlib.Path(sys.argv[1])
path = [part for part in sys.argv[2].split('.') if part]
data = json.loads(file_path.read_text(encoding='utf-8'))
value = data
for part in path:
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(0)
    value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is not None:
    print(value)
PY
}

demo_release_id() {
  local value
  value="$(demo_state_value release.id)"
  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
    return 0
  fi
  if [[ -L "${DEMO_REHEARSAL_CURRENT_LINK}" || -d "${DEMO_REHEARSAL_CURRENT_LINK}" ]]; then
    awk -F= '$1=="release_id"{print $2}' "${DEMO_REHEARSAL_CURRENT_LINK}/VERSION" 2>/dev/null || true
  fi
}

demo_site_env_path() {
  if [[ -f "${DEMO_REHEARSAL_ROOT}/config/site.env" ]]; then
    printf '%s\n' "${DEMO_REHEARSAL_ROOT}/config/site.env"
  else
    printf '%s\n' "${ROOT_DIR}/env/site.env.example"
  fi
}

demo_env_value() {
  local key="$1"
  local path
  path="$(demo_site_env_path)"
  site_env_value "${path}" "${key}"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true
}

run_stage() {
  local stage="$1"
  bash "${ROOT_DIR}/scripts/demo-deploy/${stage}.sh"
}

demo_phase_value() {
  local phase
  phase="${1:-$(demo_state_value release.phase)}"
  printf '%s\n' "${phase}"
}

demo_phase_at_least_deployed() {
  local phase
  phase="$(demo_phase_value "${1:-}")"
  [[ "${phase}" == "deploy_completed" || "${phase}" == "bootstrap_completed" || "${phase}" == "verify_completed" ]]
}

demo_phase_at_least_bootstrapped() {
  local phase
  phase="$(demo_phase_value "${1:-}")"
  [[ "${phase}" == "bootstrap_completed" || "${phase}" == "verify_completed" ]]
}

demo_phase_verified() {
  local phase
  phase="$(demo_phase_value "${1:-}")"
  [[ "${phase}" == "verify_completed" ]]
}

demo_require_phase() {
  local action="$1"
  local phase
  phase="$(demo_phase_value)"

  case "${action}" in
    bootstrap)
      if demo_phase_at_least_deployed "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[demo-rehearsal] ERROR: bootstrap requires an environment prepared by demo-rehearsal-up.
[demo-rehearsal] Current phase: ${phase:-unset}
[demo-rehearsal] Next step: make demo-rehearsal-up
EOF
      ;;
    verify)
      if demo_phase_at_least_bootstrapped "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[demo-rehearsal] ERROR: verify requires a bootstrapped rehearsal line.
[demo-rehearsal] Current phase: ${phase:-unset}
[demo-rehearsal] Next step: make demo-rehearsal-bootstrap
EOF
      ;;
    report)
      if demo_phase_verified "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[demo-rehearsal] ERROR: report requires a completed verify run.
[demo-rehearsal] Current phase: ${phase:-unset}
[demo-rehearsal] Next step: make demo-rehearsal-verify
EOF
      ;;
    *)
      echo "[demo-rehearsal] ERROR: unsupported phase guard: ${action}" >&2
      ;;
  esac
  exit 1
}

demo_stage_summary() {
  local phase
  phase="$(demo_phase_value)"

  if demo_phase_verified "${phase}"; then
    printf 'verify completed\n'
  elif demo_phase_at_least_bootstrapped "${phase}"; then
    printf 'bootstrapped\n'
  elif demo_phase_at_least_deployed "${phase}"; then
    printf 'environment ready\n'
  elif [[ -n "${phase}" ]]; then
    printf '%s\n' "${phase}"
  else
    printf 'not started\n'
  fi
}
