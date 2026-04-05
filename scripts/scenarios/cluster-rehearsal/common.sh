#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "${ROOT_DIR}/scripts/scenarios/common.sh"

CLUSTER_REHEARSAL_NAME="cluster-rehearsal"
CLUSTER_REHEARSAL_ROOT_DEFAULT="${ROOT_DIR}/artifacts/runtime/scenario/${CLUSTER_REHEARSAL_NAME}"
CLUSTER_REHEARSAL_ROOT="${CLUSTER_REHEARSAL_ROOT:-${CLUSTER_REHEARSAL_ROOT_DEFAULT}}"
CLUSTER_REHEARSAL_RELEASES_DIR="${CLUSTER_REHEARSAL_ROOT}/releases"
CLUSTER_REHEARSAL_CURRENT_LINK="${CLUSTER_REHEARSAL_ROOT}/current"
CLUSTER_REHEARSAL_CONFIG_DIR="${CLUSTER_REHEARSAL_ROOT}/config"

init_cluster_rehearsal_env() {
  load_flow_env "${CLUSTER_REHEARSAL_NAME}"
  mkdir -p "${CLUSTER_REHEARSAL_ROOT}" "${CLUSTER_REHEARSAL_RELEASES_DIR}" "${CLUSTER_REHEARSAL_CONFIG_DIR}"
  export ROOT_DIR
  export CLUSTER_DEPLOY_ROOT="${CLUSTER_REHEARSAL_ROOT}"
  if [[ -e "${CLUSTER_REHEARSAL_CURRENT_LINK}" ]]; then
    export RELEASE_ROOT="$(cd -P "${CLUSTER_REHEARSAL_CURRENT_LINK}" && pwd)"
  else
    export RELEASE_ROOT="${ROOT_DIR}"
  fi
  export CLUSTER_DEPLOY_MODE="${CLUSTER_DEPLOY_MODE:-full-auto}"
}

ensure_cluster_rehearsal_registry_env() {
  local registry_host="${CLUSTER_REHEARSAL_REGISTRY_HOST:-localhost:5001}"
  local k8s_registry_host="${CLUSTER_REHEARSAL_K8S_REGISTRY_HOST:-kind-registry:5000}"
  cat > "${CLUSTER_REHEARSAL_CONFIG_DIR}/registry.env" <<EOF
REGISTRY_HOST=${registry_host}
REGISTRY_PROJECT=mbos
REGISTRY_USERNAME=
REGISTRY_PASSWORD=
K8S_REGISTRY_HOST=${k8s_registry_host}
EOF
}

ensure_cluster_rehearsal_site_env() {
  local site_env="${CLUSTER_REHEARSAL_CONFIG_DIR}/site.env"
  if [[ ! -f "${site_env}" ]]; then
    if [[ -f "${ROOT_DIR}/.infra/cluster-deploy/site.env" ]]; then
      cp "${ROOT_DIR}/.infra/cluster-deploy/site.env" "${site_env}"
    else
      cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${site_env}"
    fi
  fi
  apply_flow_site_env_overrides "${site_env}"
}

ensure_cluster_rehearsal_release_bundle() {
  local release_id="cluster-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
  OUT_DIR="${CLUSTER_REHEARSAL_RELEASES_DIR}" RELEASE_ID="${release_id}" bash "${ROOT_DIR}/scripts/cluster-deploy/build-bundle.sh"
  export RELEASE_ROOT="${CLUSTER_REHEARSAL_RELEASES_DIR}/agentsmith-${release_id}"
}

cluster_state_file() {
  printf '%s/state/deploy-state.json\n' "${CLUSTER_REHEARSAL_ROOT}"
}

cluster_state_value() {
  local key="$1"
  local file
  file="$(cluster_state_file)"
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

cluster_release_id() {
  local value
  value="$(cluster_state_value release.id)"
  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
    return 0
  fi
  if [[ -L "${CLUSTER_REHEARSAL_CURRENT_LINK}" || -d "${CLUSTER_REHEARSAL_CURRENT_LINK}" ]]; then
    awk -F= '$1=="release_id"{print $2}' "${CLUSTER_REHEARSAL_CURRENT_LINK}/VERSION" 2>/dev/null || true
  fi
}

cluster_site_env_path() {
  if [[ -f "${CLUSTER_REHEARSAL_ROOT}/config/site.env" ]]; then
    printf '%s\n' "${CLUSTER_REHEARSAL_ROOT}/config/site.env"
  else
    printf '%s\n' "${ROOT_DIR}/env/site.env.example"
  fi
}

cluster_env_value() {
  local key="$1"
  local path
  path="$(cluster_site_env_path)"
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
  bash "${ROOT_DIR}/scripts/cluster-deploy/${stage}.sh"
}

cluster_phase_value() {
  local phase
  phase="${1:-$(cluster_state_value release.phase)}"
  printf '%s\n' "${phase}"
}

cluster_phase_at_least_app_deployed() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  case "${phase}" in
    deploy_app_completed|admin_handoff_prepared|apply_cluster_prereqs_completed|deploy_sandbox_completed|bootstrap_completed|verify_completed)
      return 0
      ;;
  esac
  return 1
}

cluster_phase_at_least_bootstrapped() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  [[ "${phase}" == "bootstrap_completed" || "${phase}" == "verify_completed" ]]
}

cluster_phase_verified() {
  local phase
  phase="$(cluster_phase_value "${1:-}")"
  [[ "${phase}" == "verify_completed" ]]
}

cluster_require_phase() {
  local action="$1"
  local phase
  phase="$(cluster_phase_value)"

  case "${action}" in
    bootstrap)
      if cluster_phase_at_least_app_deployed "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: bootstrap requires an environment prepared by cluster-rehearsal-up.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-up
EOF
      ;;
    verify)
      if cluster_phase_at_least_bootstrapped "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: verify requires a bootstrapped rehearsal line.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-bootstrap
EOF
      ;;
    report)
      if cluster_phase_verified "${phase}"; then
        return 0
      fi
      cat >&2 <<EOF
[cluster-rehearsal] ERROR: report requires a completed verify run.
[cluster-rehearsal] Current phase: ${phase:-unset}
[cluster-rehearsal] Next step: make cluster-rehearsal-verify
EOF
      ;;
    *)
      echo "[cluster-rehearsal] ERROR: unsupported phase guard: ${action}" >&2
      ;;
  esac
  exit 1
}

cluster_stage_summary() {
  local phase
  phase="$(cluster_phase_value)"

  if cluster_phase_verified "${phase}"; then
    printf 'verify completed\n'
  elif cluster_phase_at_least_bootstrapped "${phase}"; then
    printf 'bootstrapped\n'
  elif cluster_phase_at_least_app_deployed "${phase}"; then
    printf 'environment ready\n'
  elif [[ -n "${phase}" ]]; then
    printf '%s\n' "${phase}"
  else
    printf 'not started\n'
  fi
}

mark_cluster_rehearsal_admin_ready() {
  local ready_env="${CLUSTER_REHEARSAL_CONFIG_DIR}/admin-ready.env"
  cat > "${ready_env}" <<EOF
ADMIN_READY=1
ADMIN_CHECKED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
}

preload_cluster_rehearsal_kind_images() {
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
  ensure_dirs
  ensure_operator_registry_env
  load_registry_env
  require_version_images

  local cluster_name="${LOCAL_KIND_CLUSTER_NAME:-agentsmith}"
  local host_images=(
    "${RUNNER_IMAGE}"
    "${SANDBOX_MANAGER_IMAGE}"
    "${JUICEFS_MOUNT_IMAGE}"
    "${JUICEFS_CSI_DRIVER_IMAGE}"
    "${JUICEFS_CSI_DASHBOARD_IMAGE}"
    "${JUICEFS_CSI_PROVISIONER_IMAGE}"
    "${JUICEFS_CSI_RESIZER_IMAGE}"
    "${JUICEFS_CSI_LIVENESSPROBE_IMAGE}"
    "${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
    "${INGRESS_NGINX_CONTROLLER_IMAGE}"
    "${INGRESS_NGINX_CERTGEN_IMAGE}"
  )
  local kind_images=(
    "${K8S_RUNNER_IMAGE}"
    "${K8S_SANDBOX_MANAGER_IMAGE}"
    "${K8S_JUICEFS_MOUNT_IMAGE}"
    "${K8S_JUICEFS_CSI_DRIVER_IMAGE}"
    "${K8S_JUICEFS_CSI_DASHBOARD_IMAGE}"
    "${K8S_JUICEFS_CSI_PROVISIONER_IMAGE}"
    "${K8S_JUICEFS_CSI_RESIZER_IMAGE}"
    "${K8S_JUICEFS_CSI_LIVENESSPROBE_IMAGE}"
    "${K8S_JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
    "${K8S_INGRESS_NGINX_CONTROLLER_IMAGE}"
    "${K8S_INGRESS_NGINX_CERTGEN_IMAGE}"
  )

  local idx host_image kind_image tarball
  for idx in "${!kind_images[@]}"; do
    host_image="${host_images[$idx]}"
    kind_image="${kind_images[$idx]}"
    [[ -n "${host_image}" && -n "${kind_image}" ]] || continue
    if [[ "${host_image}" != "${kind_image}" ]]; then
      docker tag "${host_image}" "${kind_image}" >/dev/null
    fi
    tarball="$(mktemp /tmp/cluster-rehearsal-kind-image.XXXXXX.tar)"
    docker save --platform linux/amd64 "${kind_image}" -o "${tarball}"
    cat "${tarball}" | docker exec -i "${cluster_name}-control-plane" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar' >/dev/null
    rm -f "${tarball}"
  done
}
