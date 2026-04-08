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
DEMO_REHEARSAL_KUBECONFIG_DEFAULT="${HOME}/.kube/config"
DEMO_REHEARSAL_KUBECONFIG="${DEMO_REHEARSAL_KUBECONFIG:-${DEMO_REHEARSAL_KUBECONFIG_DEFAULT}}"

init_demo_rehearsal_env() {
  load_flow_env "${DEMO_REHEARSAL_NAME}"
  mkdir -p "${DEMO_REHEARSAL_ROOT}" "${DEMO_REHEARSAL_RELEASES_DIR}" "${DEMO_REHEARSAL_CONFIG_DIR}" "$(dirname "${DEMO_REHEARSAL_KUBECONFIG}")"
  export ROOT_DIR
  export DEMO_DEPLOY_ROOT="${DEMO_REHEARSAL_ROOT}"
  export KUBECONFIG="${DEMO_REHEARSAL_KUBECONFIG}"
  if [[ -e "${DEMO_REHEARSAL_CURRENT_LINK}" ]]; then
    export RELEASE_ROOT="$(cd -P "${DEMO_REHEARSAL_CURRENT_LINK}" && pwd)"
  else
    export RELEASE_ROOT="${ROOT_DIR}"
  fi
}

ensure_demo_rehearsal_site_env() {
  local site_env="${DEMO_REHEARSAL_CONFIG_DIR}/site.env"
  if [[ ! -f "${site_env}" ]]; then
    cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${site_env}"
  fi
  apply_flow_site_env_overrides "${site_env}"
  validate_demo_rehearsal_site_env "${site_env}"
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
  OUT_DIR="${DEMO_REHEARSAL_RELEASES_DIR}" RELEASE_ID="${release_id}" SKIP_RELEASE_PRECHECK=1 bash "${ROOT_DIR}/scripts/demo-deploy/build-offline-bundle.sh"
  export RELEASE_ROOT="${DEMO_REHEARSAL_RELEASES_DIR}/agentsmith-${release_id}"
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
  python3 - <<'PY' "${path}" "${key}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
if not path.exists():
    raise SystemExit(0)
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    name, value = line.split('=', 1)
    if name.strip() == key:
        print(value.strip().strip('"').strip("'"))
        break
PY
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
