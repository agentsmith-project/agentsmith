#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
info() { echo "[backend-real-reset] $*"; }
die() { echo "[backend-real-reset] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash scripts/backend-real-reset.sh [--help]

Resets backend-real local state and, when kubectl is available, performs a
guarded Kubernetes sandbox cleanup.

Kubernetes reset is fail-closed by default:
  BACKEND_REAL_RESET_KUBE_CONTEXT
    Required when BACKEND_REAL_RESET_KUBE_MODE=guarded and kubectl is present.
    Must exactly match `kubectl config current-context`.

  BACKEND_REAL_RESET_KUBE_NAMESPACE
    Namespace to reset. Defaults to INTERNAL_AGENT_K8S_NAMESPACE or
    agentsmith-sandbox. The namespace name must be explicit and valid.

  BACKEND_REAL_RESET_KUBE_OWNER_LABEL_KEY / BACKEND_REAL_RESET_KUBE_OWNER_LABEL_VALUE
    Owner label required on the namespace and used as the selector for
    namespace-scoped and cluster-scoped deletions. Defaults to
    app.kubernetes.io/managed-by=agentsmith.

  BACKEND_REAL_RESET_KUBE_MODE=skip
    Explicit safe override that skips all Kubernetes destructive actions while
    still clearing local backend-real state and Docker integration volumes.

No unsafe context/owner bypass is supported. If a namespace is missing the owner
label, label or recreate that backend-real sandbox intentionally before reset.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "$#" -gt 0 ]]; then
  usage >&2
  die "unknown argument: $1"
fi

source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

STATE_DIR="$(backend_real_state_root)"
KUBE_MODE="${BACKEND_REAL_RESET_KUBE_MODE:-guarded}"
EXPECTED_KUBE_CONTEXT="${BACKEND_REAL_RESET_KUBE_CONTEXT:-}"
SANDBOX_NAMESPACE="${BACKEND_REAL_RESET_KUBE_NAMESPACE:-${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}}"
KUBE_OWNER_LABEL_KEY="${BACKEND_REAL_RESET_KUBE_OWNER_LABEL_KEY:-app.kubernetes.io/managed-by}"
KUBE_OWNER_LABEL_VALUE="${BACKEND_REAL_RESET_KUBE_OWNER_LABEL_VALUE:-agentsmith}"
KUBE_OWNER_SELECTOR="${KUBE_OWNER_LABEL_KEY}=${KUBE_OWNER_LABEL_VALUE}"
KUBE_RESET_ENABLED=0

validate_namespace_name() {
  local namespace="$1"
  [[ "${namespace}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]]
}

kube_jsonpath_label_key() {
  printf '%s' "$1" | sed 's/\./\\./g'
}

prepare_kubernetes_reset() {
  if ! command -v kubectl >/dev/null 2>&1; then
    info "kubectl not found; skipping Kubernetes sandbox cleanup"
    return 0
  fi

  case "${KUBE_MODE}" in
    guarded) ;;
    skip)
      info "BACKEND_REAL_RESET_KUBE_MODE=skip; skipping Kubernetes sandbox cleanup"
      return 0
      ;;
    *)
      die "BACKEND_REAL_RESET_KUBE_MODE must be guarded or skip"
      ;;
  esac

  [[ -n "${EXPECTED_KUBE_CONTEXT}" ]] \
    || die "BACKEND_REAL_RESET_KUBE_CONTEXT is required before Kubernetes cleanup"
  validate_namespace_name "${SANDBOX_NAMESPACE}" \
    || die "BACKEND_REAL_RESET_KUBE_NAMESPACE is invalid: ${SANDBOX_NAMESPACE}"
  [[ -n "${KUBE_OWNER_LABEL_KEY}" && -n "${KUBE_OWNER_LABEL_VALUE}" ]] \
    || die "Kubernetes owner label key/value are required before cleanup"

  local actual_context
  actual_context="$(kubectl config current-context 2>/dev/null || true)"
  [[ -n "${actual_context}" ]] \
    || die "kubectl current-context is empty; refusing Kubernetes cleanup"
  [[ "${actual_context}" == "${EXPECTED_KUBE_CONTEXT}" ]] \
    || die "kubectl context mismatch: expected ${EXPECTED_KUBE_CONTEXT}, got ${actual_context}"

  if kubectl get namespace "${SANDBOX_NAMESPACE}" >/dev/null 2>&1; then
    local escaped_label_key actual_owner_label
    escaped_label_key="$(kube_jsonpath_label_key "${KUBE_OWNER_LABEL_KEY}")"
    actual_owner_label="$(
      kubectl get namespace "${SANDBOX_NAMESPACE}" -o "jsonpath={.metadata.labels.${escaped_label_key}}" 2>/dev/null \
        || true
    )"
    [[ "${actual_owner_label}" == "${KUBE_OWNER_LABEL_VALUE}" ]] \
      || die "namespace ${SANDBOX_NAMESPACE} must be labelled ${KUBE_OWNER_SELECTOR} before reset"
  else
    info "sandbox namespace ${SANDBOX_NAMESPACE} is absent; only labelled cluster-scoped residue will be considered"
  fi

  KUBE_RESET_ENABLED=1
}

wait_for_absent() {
  local kind="$1"
  local name="$2"
  local namespace="${3:-}"
  local timeout_sec="${4:-60}"
  local deadline=$((SECONDS + timeout_sec))
  while (( SECONDS < deadline )); do
    if [[ -n "${namespace}" ]]; then
      if ! kubectl get "${kind}" "${name}" -n "${namespace}" >/dev/null 2>&1; then
        return 0
      fi
    else
      if ! kubectl get "${kind}" "${name}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

backend_real_read_pid_file() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    tr -d '[:space:]' < "${file}"
  fi
}

backend_real_pid_alive() {
  local pid="${1:-}"
  local stat
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1 || return 1
  stat="$(ps -o stat= -p "${pid}" 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "${stat}" != Z* ]]
}

backend_real_process_command() {
  local pid="$1"
  ps -ww -p "${pid}" -o command= 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true
}

backend_real_process_group_id() {
  local pid="$1"
  ps -o pgid= -p "${pid}" 2>/dev/null | tr -d '[:space:]' || true
}

backend_real_cleaner_command_owned() {
  local command="$1"
  local owner_root="$2"
  [[ -n "${command}" && -n "${owner_root}" ]] || return 1
  case "${command}" in
    *"${owner_root}/"*"/sandbox-cleaner"*|*"${owner_root}/sandbox-cleaner"*) return 0 ;;
    *) return 1 ;;
  esac
}

backend_real_signal_owned_cleaner_pid() {
  local pid="$1"
  local signal="$2"
  local pgid
  pgid="$(backend_real_process_group_id "${pid}")"
  if [[ "${pgid}" == "${pid}" ]]; then
    kill "-${signal}" -- "-${pid}" >/dev/null 2>&1 || true
    return 0
  fi
  kill "-${signal}" "${pid}" >/dev/null 2>&1 || true
}

backend_real_stop_owned_cleaner_pid() {
  local pid="$1"
  local owner_root="$2"
  local label="$3"
  local command
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 0
  if ! backend_real_pid_alive "${pid}"; then
    return 0
  fi
  command="$(backend_real_process_command "${pid}")"
  if ! backend_real_cleaner_command_owned "${command}" "${owner_root}"; then
    info "skipping ${label} pid=${pid}; command does not prove backend-real ownership"
    return 0
  fi

  info "stopping ${label} pid=${pid}"
  backend_real_signal_owned_cleaner_pid "${pid}" TERM
  for _ in $(seq 1 20); do
    if ! backend_real_pid_alive "${pid}"; then
      return 0
    fi
    sleep 0.2
  done
  backend_real_signal_owned_cleaner_pid "${pid}" KILL
  for _ in $(seq 1 10); do
    if ! backend_real_pid_alive "${pid}"; then
      return 0
    fi
    sleep 0.2
  done
  info "${label} pid=${pid} still appears alive after SIGKILL"
}

backend_real_env_path_value() {
  local file="$1"
  local key="$2"
  sed -n \
    -e "s/^${key}=\"\\(.*\\)\"$/\\1/p" \
    -e "s/^${key}=\\([^[:space:]#]*\\).*$/\\1/p" \
    "${file}" 2>/dev/null | tail -n 1 || true
}

backend_real_runtime_dir_under_state() {
  local runtime_dir="$1"
  local resolved_runtime_dir resolved_state_dir
  [[ -n "${runtime_dir}" ]] || return 1
  resolved_runtime_dir="$(realpath -m "${runtime_dir}")"
  resolved_state_dir="$(realpath -m "${STATE_DIR}")"
  [[ "${resolved_runtime_dir}" == "${resolved_state_dir}" || "${resolved_runtime_dir}" == "${resolved_state_dir}/"* ]]
}

backend_real_stop_cleaner_runtime_dir() {
  local runtime_dir="$1"
  local resolved_runtime_dir pid_file pid
  backend_real_runtime_dir_under_state "${runtime_dir}" || return 0
  resolved_runtime_dir="$(realpath -m "${runtime_dir}")"
  pid_file="${resolved_runtime_dir}/sandbox-cleaner.pid"
  [[ -f "${pid_file}" ]] || return 0
  pid="$(backend_real_read_pid_file "${pid_file}")"
  backend_real_stop_owned_cleaner_pid "${pid}" "${resolved_runtime_dir}" "sandbox-cleaner"
  if ! backend_real_pid_alive "${pid}"; then
    rm -f "${pid_file}"
  fi
}

stop_backend_real_sandbox_cleaners() {
  local state_file runtime_dir line pid
  if [[ ! -d "${STATE_DIR}" ]]; then
    return 0
  fi

  info "stopping backend-real sandbox cleaner loops under ${STATE_DIR}"
  while IFS= read -r state_file; do
    [[ -n "${state_file}" ]] || continue
    runtime_dir="$(backend_real_env_path_value "${state_file}" INTERNAL_REAL_DIR)"
    backend_real_stop_cleaner_runtime_dir "${runtime_dir}"
  done < <(find "${STATE_DIR}" -type f -name 'sandbox-control.env' 2>/dev/null | sort)

  while IFS= read -r runtime_dir; do
    [[ -n "${runtime_dir}" ]] || continue
    backend_real_stop_cleaner_runtime_dir "${runtime_dir}"
  done < <(find "${STATE_DIR}" -type f -name 'sandbox-cleaner.pid' -printf '%h\n' 2>/dev/null | sort -u)

  while IFS= read -r line; do
    [[ -n "${line}" ]] || continue
    line="${line#"${line%%[![:space:]]*}"}"
    pid="${line%%[[:space:]]*}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || continue
    backend_real_stop_owned_cleaner_pid "${pid}" "${STATE_DIR}" "sandbox-cleaner-scan"
  done < <(ps -ww -eo pid=,command= 2>/dev/null | grep -F "${STATE_DIR}/" | grep -F '/sandbox-cleaner' || true)
}

prepare_kubernetes_reset

stop_backend_real_sandbox_cleaners

info "clearing backend-real state under ${STATE_DIR}"
rm -rf "${STATE_DIR}"
ensure_backend_real_state

if command -v docker >/dev/null 2>&1; then
  info "resetting integration docker volumes"
  (cd "${ROOT_DIR}" && npm run integration:deps:down:volumes >/dev/null)
fi

if [[ "${KUBE_RESET_ENABLED}" -eq 1 ]]; then
  if kubectl get namespace "${SANDBOX_NAMESPACE}" >/dev/null 2>&1; then
    info "deleting sandbox PVCs in ${SANDBOX_NAMESPACE} with ${KUBE_OWNER_SELECTOR}"
    kubectl delete pvc -l "${KUBE_OWNER_SELECTOR}" -n "${SANDBOX_NAMESPACE}" --ignore-not-found --wait=false >/dev/null
  fi

  info "deleting AgentSmith-owned JuiceFS mount pods"
  mount_pods="$(
    kubectl get pods -n kube-system -l "${KUBE_OWNER_SELECTOR}" -o name 2>/dev/null \
      | grep '^pod/juicefs-.*-juicefs-' \
      || true
  )"
  if [[ -n "${mount_pods}" ]]; then
    printf '%s\n' "${mount_pods}" | xargs -r kubectl delete -n kube-system --wait=false >/dev/null
  fi

  info "deleting AgentSmith-owned JuiceFS PVs"
  juicefs_pvs="$(kubectl get pv -l "${KUBE_OWNER_SELECTOR}" -o name 2>/dev/null | grep 'juicefs' || true)"
  if [[ -n "${juicefs_pvs}" ]]; then
    printf '%s\n' "${juicefs_pvs}" | xargs -r kubectl delete --wait=false >/dev/null
    while read -r pv; do
      [[ -n "${pv}" ]] || continue
      pv_name="${pv#persistentvolume/}"
      if ! wait_for_absent persistentvolume "${pv_name}" "" 20; then
        info "clearing PV finalizers for ${pv_name}"
        kubectl patch persistentvolume "${pv_name}" --type=merge -p '{"metadata":{"finalizers":[]}}' >/dev/null
      fi
    done <<< "${juicefs_pvs}"
  fi

  info "deleting sandbox namespace ${SANDBOX_NAMESPACE}"
  kubectl delete namespace "${SANDBOX_NAMESPACE}" --ignore-not-found --wait=false >/dev/null
  if ! wait_for_absent namespace "${SANDBOX_NAMESPACE}" "" 30; then
    info "clearing namespace finalizers for ${SANDBOX_NAMESPACE}"
    kubectl patch namespace "${SANDBOX_NAMESPACE}" --type=merge -p '{"spec":{"finalizers":[]}}' >/dev/null
  fi
fi

state_set_string release.phase "reset_completed"
state_set_string release.last_reset_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backend-real-reset] done"
