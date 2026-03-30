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
  python3 - <<'PYTHON' "${site_env}"
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
desired = {
    "MBOS_AGENT_BUILTIN_SKILLS_DIR": "/etc/codex/skills",
    "COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL": "http://host.docker.internal:29080",
}
updated = []
seen = set()
for line in lines:
    replaced = False
    for key, value in desired.items():
        if line.startswith(f"{key}="):
            updated.append(f"{key}={value}")
            seen.add(key)
            replaced = True
            break
    if not replaced:
        updated.append(line)
for key, value in desired.items():
    if key not in seen:
        updated.append(f"{key}={value}")
path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PYTHON
}

ensure_cluster_rehearsal_release_bundle() {
  if [[ -e "${CLUSTER_REHEARSAL_CURRENT_LINK}" ]]; then
    export RELEASE_ROOT="$(cd -P "${CLUSTER_REHEARSAL_CURRENT_LINK}" && pwd)"
    return 0
  fi
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
