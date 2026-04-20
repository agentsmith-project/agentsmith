#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
source "${ROOT_DIR}/scripts/lib/local-kind-world.sh"
SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT:-${ROOT_DIR}/artifacts/runtime}"
ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE:-${SCENARIO_RUNTIME_ROOT}/active-scenario.lock}"
SCENARIO_CLEANUP_TRAP_ARMED="${SCENARIO_CLEANUP_TRAP_ARMED:-0}"

ensure_scenario_dirs() {
  mkdir -p "${SCENARIO_RUNTIME_ROOT}"
}

scenario_command_lock_dir() {
  local scenario="$1"
  printf '%s/%s.command.lock\n' "${SCENARIO_RUNTIME_ROOT}" "${scenario}"
}

current_active_scenario() {
  [[ -f "${ACTIVE_SCENARIO_LOCK_FILE}" ]] || return 0
  cat "${ACTIVE_SCENARIO_LOCK_FILE}" 2>/dev/null || true
}

flow_env_file() {
  local flow_name="$1"
  printf '%s/infra/flows/%s.env\n' "${ROOT_DIR}" "${flow_name}"
}

load_flow_env() {
  local flow_name="$1"
  local file
  file="$(flow_env_file "${flow_name}")"
  [[ -f "${file}" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "${file}"
  set +a
}

apply_flow_site_env_overrides() {
  local path="$1"
  python3 - <<'PY' "${path}"
from pathlib import Path
import os
import sys

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
desired = {}
for key, value in os.environ.items():
    if key.startswith("FLOW_SITE_ENV_"):
        desired[key[len("FLOW_SITE_ENV_"):]] = value

if not desired:
    raise SystemExit(0)

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
PY
}

site_env_value() {
  local path="$1"
  local key="$2"
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

write_site_env_value() {
  local path="$1"
  local key="$2"
  local value="$3"
  python3 - <<'PY' "${path}" "${key}" "${value}"
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
updated = []
replaced = False

for line in lines:
    stripped = line.strip()
    if stripped and not stripped.startswith('#') and stripped.startswith(f"{key}="):
        updated.append(f"{key}={value}")
        replaced = True
        continue
    updated.append(line)

if not replaced:
    updated.append(f"{key}={value}")

path.write_text("\n".join(updated) + "\n", encoding='utf-8')
PY
}

scenario_deterministic_secret_value() {
  local secret_scope="$1"
  local site_env_path="$2"
  local key="$3"
  python3 - <<'PY' "${secret_scope}" "${site_env_path}" "${key}"
import hashlib
from pathlib import Path
import sys

secret_scope = sys.argv[1]
site_env_path = str(Path(sys.argv[2]).resolve())
key = sys.argv[3]
seed = f"{secret_scope}:{key}:{site_env_path}".encode("utf-8")
digest = hashlib.sha256(seed).hexdigest()
print(f"scenario-{secret_scope}-{digest[:32]}")
PY
}

ensure_scenario_site_env_secret() {
  local site_env="$1"
  local key="$2"
  local secret_scope="$3"
  local current_value generated_value

  current_value="$(site_env_value "${site_env}" "${key}")"
  if [[ -n "${current_value}" ]]; then
    return 0
  fi

  generated_value="$(scenario_deterministic_secret_value "${secret_scope}" "${site_env}" "${key}")"
  write_site_env_value "${site_env}" "${key}" "${generated_value}"
}

ensure_scenario_site_env_proxy_admin_token() {
  local site_env="$1"
  local scenario_name="${2:-scenario}"
  ensure_scenario_site_env_secret "${site_env}" MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN "${scenario_name}-proxy-admin-token"
}

render_scenario_owned_kind_config() {
  local template_path="$1"
  local output_path="$2"
  local cluster_name="$3"
  local sandbox_host_port="$4"
  python3 - <<'PY' "${template_path}" "${output_path}" "${cluster_name}" "${sandbox_host_port}"
from pathlib import Path
import sys

template_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
cluster_name = sys.argv[3]
sandbox_host_port = sys.argv[4]
lines = template_path.read_text(encoding="utf-8").splitlines()

updated = []
replaced_name = False
replaced_host_port = False
for line in lines:
    stripped = line.lstrip()
    if line.startswith("name: "):
        updated.append(f"name: {cluster_name}")
        replaced_name = True
        continue
    if stripped.startswith("hostPort: "):
        indent = line[: len(line) - len(stripped)]
        updated.append(f"{indent}hostPort: {sandbox_host_port}")
        replaced_host_port = True
        continue
    updated.append(line)

if not replaced_name:
    raise SystemExit(f"missing cluster name field in {template_path}")
if not replaced_host_port:
    raise SystemExit(f"missing hostPort field in {template_path}")

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
}

scenario_http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true
}

scenario_service_status() {
  local scenario="$1"
  local url="$2"
  local active
  active="$(current_active_scenario || true)"
  if [[ "${active}" != "${scenario}" ]]; then
    printf 'inactive\n'
    return 0
  fi
  scenario_http_code "${url}"
}

acquire_scenario_lock() {
  local scenario="$1"
  ensure_scenario_dirs
  local current="$(current_active_scenario)"
  if [[ -n "${current}" && "${current}" != "${scenario}" ]]; then
    echo "[scenario] ERROR: active scenario is ${current}; stop it before starting ${scenario}." >&2
    exit 1
  fi
  printf '%s
' "${scenario}" > "${ACTIVE_SCENARIO_LOCK_FILE}"
}

release_scenario_lock() {
  local scenario="$1"
  local current="$(current_active_scenario)"
  if [[ "${current}" == "${scenario}" ]]; then
    rm -f "${ACTIVE_SCENARIO_LOCK_FILE}"
  fi
}

current_scenario_command() {
  local scenario="$1"
  local lock_dir
  lock_dir="$(scenario_command_lock_dir "${scenario}")"
  [[ -f "${lock_dir}/command" ]] || return 0
  cat "${lock_dir}/command" 2>/dev/null || true
}

scenario_command_lock_pid() {
  local scenario="$1"
  local lock_dir
  lock_dir="$(scenario_command_lock_dir "${scenario}")"
  [[ -f "${lock_dir}/pid" ]] || return 0
  cat "${lock_dir}/pid" 2>/dev/null || true
}

scenario_command_lock_started_at() {
  local scenario="$1"
  local lock_dir
  lock_dir="$(scenario_command_lock_dir "${scenario}")"
  [[ -f "${lock_dir}/started_at" ]] || return 0
  cat "${lock_dir}/started_at" 2>/dev/null || true
}

release_scenario_command_lock() {
  local scenario="$1"
  local command="${2:-}"
  local lock_dir
  local current_command
  lock_dir="$(scenario_command_lock_dir "${scenario}")"
  [[ -d "${lock_dir}" ]] || return 0
  current_command="$(current_scenario_command "${scenario}" || true)"
  if [[ -n "${command}" && -n "${current_command}" && "${command}" != "${current_command}" ]]; then
    return 0
  fi
  rm -rf "${lock_dir}"
}

prune_stale_scenario_command_lock() {
  local scenario="$1"
  local pid
  pid="$(scenario_command_lock_pid "${scenario}" || true)"
  [[ -n "${pid}" ]] || return 1
  if kill -0 "${pid}" >/dev/null 2>&1; then
    return 1
  fi
  release_scenario_command_lock "${scenario}"
  return 0
}

acquire_scenario_command_lock() {
  local scenario="$1"
  local command="$2"
  ensure_scenario_dirs
  local lock_dir
  local current_command
  local current_pid
  local current_started_at
  lock_dir="$(scenario_command_lock_dir "${scenario}")"
  if ! mkdir "${lock_dir}" 2>/dev/null; then
    if ! prune_stale_scenario_command_lock "${scenario}"; then
      current_command="$(current_scenario_command "${scenario}" || true)"
      current_pid="$(scenario_command_lock_pid "${scenario}" || true)"
      current_started_at="$(scenario_command_lock_started_at "${scenario}" || true)"
      echo "[scenario] ERROR: ${scenario} command lock is held by ${current_command:-unknown} (pid=${current_pid:-unknown}, started_at=${current_started_at:-unknown}); wait for it to finish before starting ${command}." >&2
      exit 1
    fi
    mkdir "${lock_dir}"
  fi
  printf '%s\n' "${scenario}" > "${lock_dir}/scenario"
  printf '%s\n' "${command}" > "${lock_dir}/command"
  printf '%s\n' "$$" > "${lock_dir}/pid"
  date -u +%Y-%m-%dT%H:%M:%SZ > "${lock_dir}/started_at"
}

arm_scenario_lock_cleanup() {
  local scenario="$1"
  ensure_scenario_cleanup_trap
  export SCENARIO_LOCK_CLEANUP_SCENARIO="${scenario}"
  export SCENARIO_LOCK_CLEANUP_ACTIVE=1
  export SCENARIO_LOCK_WORLD_CHANGED=0
}

disarm_scenario_lock_cleanup() {
  export SCENARIO_LOCK_CLEANUP_ACTIVE=0
  export SCENARIO_LOCK_WORLD_CHANGED=0
  export SCENARIO_LOCK_CLEANUP_SCENARIO=""
}

arm_scenario_command_lock_cleanup() {
  local scenario="$1"
  local command="$2"
  ensure_scenario_cleanup_trap
  export SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO="${scenario}"
  export SCENARIO_COMMAND_LOCK_CLEANUP_COMMAND="${command}"
  export SCENARIO_COMMAND_LOCK_CLEANUP_ACTIVE=1
}

disarm_scenario_command_lock_cleanup() {
  if [[ -n "${SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO:-}" ]]; then
    release_scenario_command_lock "${SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO}" "${SCENARIO_COMMAND_LOCK_CLEANUP_COMMAND:-}"
  fi
  export SCENARIO_COMMAND_LOCK_CLEANUP_ACTIVE=0
  export SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO=""
  export SCENARIO_COMMAND_LOCK_CLEANUP_COMMAND=""
}

ensure_scenario_cleanup_trap() {
  if [[ "${SCENARIO_CLEANUP_TRAP_ARMED:-0}" == "1" ]]; then
    return 0
  fi
  export SCENARIO_CLEANUP_TRAP_ARMED=1
  trap 'scenario_common_cleanup_on_exit $?' EXIT
}

mark_scenario_world_changed() {
  export SCENARIO_LOCK_WORLD_CHANGED=1
}

scenario_recovery_hint() {
  local scenario="$1"
  cat >&2 <<EOF
[scenario] WARN: ${scenario} remains active because the command failed after changing the environment.
[scenario] Next steps: make ${scenario}-status && then make ${scenario}-down or make ${scenario}-reset
EOF
}

scenario_lock_cleanup_on_exit() {
  local status="${1:-0}"
  if [[ "${SCENARIO_LOCK_CLEANUP_ACTIVE:-0}" != "1" || -z "${SCENARIO_LOCK_CLEANUP_SCENARIO:-}" ]]; then
    return 0
  fi
  if [[ "${status}" == "0" ]]; then
    return 0
  fi
  if [[ "${SCENARIO_LOCK_WORLD_CHANGED:-0}" == "1" ]]; then
    scenario_recovery_hint "${SCENARIO_LOCK_CLEANUP_SCENARIO}"
  else
    release_scenario_lock "${SCENARIO_LOCK_CLEANUP_SCENARIO}"
  fi
}

scenario_command_lock_cleanup_on_exit() {
  if [[ "${SCENARIO_COMMAND_LOCK_CLEANUP_ACTIVE:-0}" != "1" || -z "${SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO:-}" ]]; then
    return 0
  fi
  release_scenario_command_lock "${SCENARIO_COMMAND_LOCK_CLEANUP_SCENARIO}" "${SCENARIO_COMMAND_LOCK_CLEANUP_COMMAND:-}"
}

scenario_common_cleanup_on_exit() {
  local status="${1:-0}"
  scenario_command_lock_cleanup_on_exit
  scenario_lock_cleanup_on_exit "${status}"
}

clear_local_dev_substrate() {
  SUBSTRATE=local-dev bash "${ROOT_DIR}/scripts/substrate/down.sh" >/dev/null 2>&1 || true
}

scenario_kind_cluster_name() {
  printf '%s\n' "${LOCAL_KIND_CLUSTER_NAME:-agentsmith}"
}

scenario_kind_context_name() {
  printf 'kind-%s\n' "$(scenario_kind_cluster_name)"
}

scenario_kind_registry_name() {
  printf '%s\n' "${LOCAL_KIND_REGISTRY_NAME:-kind-registry}"
}

scenario_kind_registry_host() {
  printf '%s\n' "${LOCAL_KIND_REGISTRY_HOST:-127.0.0.1}"
}

scenario_kind_registry_host_port() {
  printf '%s\n' "${LOCAL_KIND_REGISTRY_HOST_PORT:-5001}"
}

scenario_local_kind_state_root() {
  if [[ -n "${DEMO_DEPLOY_ROOT:-}" ]]; then
    printf '%s\n' "${DEMO_DEPLOY_ROOT}/state/local-kind"
    return 0
  fi
  if [[ -n "${CLUSTER_DEPLOY_ROOT:-}" ]]; then
    printf '%s\n' "${CLUSTER_DEPLOY_ROOT}/state/local-kind"
    return 0
  fi
  printf '%s\n' "${HOME}/agentsmith/local-kind"
}

scenario_kind_kubeconfig_path() {
  local cluster_name="${1:-$(scenario_kind_cluster_name)}"
  printf '%s/%s\n' "$(scenario_local_kind_state_root)" "kind-${cluster_name}.kubeconfig"
}

scenario_local_kind_cleanup() {
  local cluster_name="${1:-$(scenario_kind_cluster_name)}"
  local registry_name="${2:-$(scenario_kind_registry_name)}"
  local state_root="${3:-$(scenario_local_kind_state_root)}"
  shift 3 || true
  local_kind_world_destroy "${cluster_name}" "${registry_name}" "${state_root}" "$@"
}

scenario_release_tool_path() {
  local tool_name="$1"
  if [[ -n "${RELEASE_ROOT:-}" && -x "${RELEASE_ROOT}/tools/${tool_name}" ]]; then
    printf '%s\n' "${RELEASE_ROOT}/tools/${tool_name}"
    return 0
  fi
  command -v "${tool_name}"
}

scenario_release_image_archive() {
  local image="$1"
  [[ -n "${RELEASE_ROOT:-}" ]] || return 1
  local archive_path="${RELEASE_ROOT}/images/$(printf '%s' "${image}" | tr '/:@' '---').tar"
  [[ -f "${archive_path}" ]] || return 1
  printf '%s\n' "${archive_path}"
}

ensure_local_kind_registry() {
  local registry_name
  registry_name="$(scenario_kind_registry_name)"
  local registry_host_port
  registry_host_port="$(scenario_kind_registry_host_port)"
  local registry_container_port="${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-5000}"
  local registry_host
  registry_host="$(scenario_kind_registry_host)"
  local registry_listen="${registry_host}:${registry_host_port}"
  local registry_image="${LOCAL_KIND_REGISTRY_IMAGE:-registry:2}"
  local cluster_name
  cluster_name="$(scenario_kind_cluster_name)"
  local scoped_kubeconfig
  scoped_kubeconfig="$(scenario_kind_kubeconfig_path "${cluster_name}")"
  local kubectl_bin
  kubectl_bin="$(scenario_release_tool_path kubectl)"

  if ! docker image inspect "${registry_image}" >/dev/null 2>&1; then
    local registry_archive=""
    registry_archive="$(scenario_release_image_archive "${registry_image}" || true)"
    [[ -n "${registry_archive}" ]] || {
      echo "[scenario-kind] ERROR: missing bundled registry image ${registry_image}" >&2
      return 1
    }
    docker load -i "${registry_archive}" >/dev/null
  fi

  if ! docker ps -a --format '{{.Names}}' | grep -qx "${registry_name}"; then
    docker run -d --restart=always -p "${registry_listen}:${registry_container_port}" --name "${registry_name}" "${registry_image}" >/dev/null
  else
    docker start "${registry_name}" >/dev/null 2>&1 || true
  fi

  docker network connect kind "${registry_name}" >/dev/null 2>&1 || true

  curl -fsS "http://${registry_host}:${registry_host_port}/v2/_catalog" >/dev/null

  KUBECONFIG="${scoped_kubeconfig}" "${kubectl_bin}" apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "${registry_name}:${registry_container_port}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF
}

ensure_local_kind_cluster() {
  local cluster_name
  cluster_name="$(scenario_kind_cluster_name)"
  local config_path="${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/demo/kind/config.yaml}"
  local state_root
  state_root="$(scenario_local_kind_state_root)"
  local scoped_kubeconfig
  scoped_kubeconfig="$(scenario_kind_kubeconfig_path "${cluster_name}")"
  local control_plane_node="${LOCAL_KIND_CONTROL_PLANE_NODE_NAME:-${cluster_name}-control-plane}"
  local kind_node_image
  kind_node_image="$(awk '/image:/ {print $2; exit}' "${config_path}")"
  local node_archive=""
  if [[ -n "${kind_node_image}" ]]; then
    node_archive="$(scenario_release_image_archive "${kind_node_image}" || true)"
  fi
  local kind_bin
  local kubectl_bin
  kind_bin="$(scenario_release_tool_path kind)"
  kubectl_bin="$(scenario_release_tool_path kubectl)"
  mkdir -p "${state_root}"
  LOCAL_KIND_STATE_ROOT="${state_root}" \
  LOCAL_KIND_FINAL_KUBECONFIG_PATH="${scoped_kubeconfig}" \
  LOCAL_KIND_NODE_IMAGE_ARCHIVE="${node_archive}" \
  LOCAL_KIND_BIN="${kind_bin}" \
  LOCAL_KIND_KUBECTL_BIN="${kubectl_bin}" \
  LOCAL_KIND_RELEASE_ROOT="${RELEASE_ROOT:-}" \
  "${ROOT_DIR}/scripts/ensure-local-kind-cluster.sh" "${cluster_name}" "${config_path}" "${control_plane_node}"
  ensure_local_kind_registry
}
