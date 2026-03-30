#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
ENDPOINT_ID="${ENDPOINT_ID:-$(state_get endpoint.id)}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
API_BASE="${API_BASE:-http://localhost:20000/api/v1}"
BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL:-$(state_get endpoint.model)}"

RUN_BASIC_SMOKE="${RUN_BASIC_SMOKE:-1}"
RUN_CREDENTIAL_SYNC_SMOKE="${RUN_CREDENTIAL_SYNC_SMOKE:-1}"
RUN_MATPLOTLIB_SMOKE="${RUN_MATPLOTLIB_SMOKE:-0}"
MATPLOTLIB_TIMEOUT_SEC="${MATPLOTLIB_TIMEOUT_SEC:-180}"

info() { echo "[engineering-smoke] $*"; }
err() { echo "[engineering-smoke] ERROR: $*" >&2; }
warn() { echo "[engineering-smoke] WARN: $*" >&2; }

read_file_trim() {
  local path="$1"
  [[ -f "${path}" ]] || return 1
  tr -d '\r\n' < "${path}"
}

proxy_precheck_status() {
  local token project_id endpoint_id url
  token="$(read_file_trim "${TOKEN_FILE}" || true)"
  project_id="${PROJECT_ID}"
  endpoint_id="${ENDPOINT_ID}"
  if [[ -z "${token}" || -z "${project_id}" || -z "${endpoint_id}" ]]; then
    echo "000"
    return 0
  fi
  url="${API_BASE}/workspaces/${WORKSPACE_ID}/projects/${project_id}/endpoints/${endpoint_id}/proxy/openai/chat/completions"
  curl -sS -o /dev/null -w '%{http_code}' \
    --max-time 20 \
    -X POST "${url}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data "$(node -e 'console.log(JSON.stringify({model:process.argv[1],messages:[{role:"user",content:"engineering smoke precheck"}]}))' "${BACKEND_REAL_MODEL}")" || true
}

wait_proxy_ready() {
  local max_attempts="${1:-6}"
  local sleep_sec="${2:-5}"
  local code refreshed=0
  for i in $(seq 1 "${max_attempts}"); do
    code="$(proxy_precheck_status)"
    case "${code}" in
      200)
        info "proxy precheck ready (HTTP 200)"
        return 0
        ;;
      429)
        warn "proxy precheck reachable but rate-limited (HTTP 429); continue with target execution"
        return 0
        ;;
      401)
        if [[ "${refreshed}" == "0" ]]; then
          info "proxy precheck unauthorized (HTTP 401); refreshing token once"
          (cd "${ROOT_DIR}" && BASE_URL="${BASE_URL:-http://localhost:3001}" make notebook-agent-refresh-token)
          refreshed=1
          continue
        fi
        ;;
      403)
        err "proxy precheck denied (HTTP 403) - check resource policy state"
        return 1
        ;;
    esac
    info "proxy precheck not ready (HTTP ${code}), waiting ${sleep_sec}s (${i}/${max_attempts})"
    sleep "${sleep_sec}"
  done
  warn "proxy precheck did not become ready; continue and let target provide concrete failure signal"
  return 0
}

run_make_target_with_token_retry() {
  local target="$1"
  local label="$2"

  run_make_target_once() {
    local _target="$1"
    local _log
    _log="$(mktemp)"
    set +e
    (cd "${ROOT_DIR}" && make "${_target}") 2>&1 | tee "${_log}"
    local _rc=${PIPESTATUS[0]}
    set -e
    if [[ "${_rc}" -eq 0 ]]; then
      rm -f "${_log}"
      return 0
    fi
    if grep -qE 'Error 75|SCENARIO_WARN' "${_log}"; then
      rm -f "${_log}"
      return 75
    fi
    rm -f "${_log}"
    return "${_rc}"
  }

  wait_proxy_ready
  local rc=0
  set +e
  run_make_target_once "${target}"
  rc=$?
  set -e
  if [[ "${rc}" -eq 75 ]]; then
    warn "${label} reported upstream throttling/transient saturation (rc=75); treating as non-blocking for engineering smoke"
    return 0
  fi
  if [[ "${rc}" -eq 0 ]]; then
    return 0
  fi
  info "${label} failed (rc=${rc}); attempting token refresh and retry once"
  (cd "${ROOT_DIR}" && BASE_URL="${BASE_URL:-http://localhost:3001}" make notebook-agent-refresh-token)
  wait_proxy_ready
  set +e
  run_make_target_once "${target}"
  rc=$?
  set -e
  if [[ "${rc}" -eq 75 ]]; then
    warn "${label} reported upstream throttling/transient saturation (rc=75) after token refresh; treating as non-blocking"
    return 0
  fi
  if [[ "${rc}" -eq 0 ]]; then
    return 0
  fi
  info "${label} still failing (rc=${rc}); backing off 20s and retrying once for transient upstream throttling"
  sleep 20
  wait_proxy_ready
  set +e
  run_make_target_once "${target}"
  rc=$?
  set -e
  if [[ "${rc}" -eq 75 ]]; then
    warn "${label} still reports upstream throttling/transient saturation (rc=75); treating as non-blocking"
    return 0
  fi
  return "${rc}"
}

run_basic_smoke() {
  info "running notebook-agent-smoke-task"
  run_make_target_with_token_retry notebook-agent-smoke-task notebook-agent-smoke-task
}

run_credential_sync_smoke() {
  info "running notebook-agent-credential-sync-smoke"
  run_make_target_with_token_retry notebook-agent-credential-sync-smoke notebook-agent-credential-sync-smoke
}

run_matplotlib_smoke() {
  info "running matplotlib artifact smoke (manual API calls)"
  local token project_id agent_id api_base ws
  api_base="${API_BASE:-http://localhost:20000/api/v1}"
  ws="${WORKSPACE_ID:-ws_default}"
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  project_id="${PROJECT_ID}"
  agent_id="$(state_get agent.id)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${agent_id}" ]]; then
    err "missing token/project/agent metadata in $(backend_real_state_file); run bootstrap/init-resources first"
    return 1
  fi
  local task_id
  task_id="$(
    curl -sS -X POST "${api_base}/workspaces/${ws}/projects/${project_id}/tasks" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data "{\"title\":\"engineering-mpl-smoke-$(date +%s)\",\"agent_id\":\"${agent_id}\"}" | \
      sed -nE 's/.*"id":"([^"]+)".*/\1/p' | head -n1
  )"
  [[ -n "${task_id}" ]] || { err "failed to create task"; return 1; }
  info "task_id=${task_id}"
  curl -sS -X POST "${api_base}/workspaces/${ws}/projects/${project_id}/tasks/${task_id}/messages" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data '{"role":"user","content":"Use python and matplotlib to generate a simple plot, save it to ./artifacts/plot.png, do not call plt.show(), then reply with the saved filename only."}' >/dev/null

  local deadline status traces terminal i artifacts_found
  deadline=$(( $(date +%s) + MATPLOTLIB_TIMEOUT_SEC ))
  terminal=""
  while [[ $(date +%s) -lt ${deadline} ]]; do
    status="$(curl -sS "${api_base}/workspaces/${ws}/projects/${project_id}/tasks/${task_id}" -H "Authorization: Bearer ${token}" | sed -nE 's/.*"status":"([^"]+)".*/\1/p' | head -n1)"
    traces="$(curl -sS "${api_base}/workspaces/${ws}/projects/${project_id}/tasks/${task_id}/traces" -H "Authorization: Bearer ${token}")"
    terminal="$(printf '%s' "${traces}" | sed -nE 's/.*"status":"(success|error|cancelled)".*/\1/p' | tail -n1)"
    artifacts_found="$(curl -sS "${api_base}/workspaces/${ws}/projects/${project_id}/tasks/${task_id}/artifacts" -H "Authorization: Bearer ${token}" | grep -c '"title":"plot.png"' || true)"
    info "poll status=${status:-unknown} terminal=${terminal:-none} plot_artifact=${artifacts_found}"
    if [[ "${artifacts_found}" != "0" ]]; then
      info "matplotlib artifact smoke OK"
      return 0
    fi
    sleep 2
  done
  err "matplotlib artifact smoke timed out waiting for plot.png artifact"
  return 1
}

main() {
  [[ -n "${PROJECT_ID}" && -n "${ENDPOINT_ID}" ]] || {
    err "missing project/endpoint metadata in $(backend_real_state_file)"
    exit 1
  }
  local failures=0
  if [[ "${RUN_BASIC_SMOKE}" == "1" ]]; then
    run_basic_smoke || failures=$((failures + 1))
  fi
  if [[ "${RUN_CREDENTIAL_SYNC_SMOKE}" == "1" ]]; then
    run_credential_sync_smoke || failures=$((failures + 1))
  fi
  if [[ "${RUN_MATPLOTLIB_SMOKE}" == "1" ]]; then
    run_matplotlib_smoke || failures=$((failures + 1))
  fi
  if [[ "${failures}" -ne 0 ]]; then
    err "engineering smoke completed with ${failures} failure(s)"
    exit 1
  fi
  info "engineering lane completed successfully"
}

main "$@"
