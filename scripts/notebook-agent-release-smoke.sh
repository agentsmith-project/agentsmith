#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RUN_BASIC_SMOKE="${RUN_BASIC_SMOKE:-1}"
RUN_INPUTREFS_LOOP="${RUN_INPUTREFS_LOOP:-1}"
RUN_MATPLOTLIB_SMOKE="${RUN_MATPLOTLIB_SMOKE:-0}"
MATPLOTLIB_TIMEOUT_SEC="${MATPLOTLIB_TIMEOUT_SEC:-180}"

info() { echo "[release-smoke] $*"; }
err() { echo "[release-smoke] ERROR: $*" >&2; }

run_make_target_with_token_retry() {
  local target="$1"
  local label="$2"
  local rc=0
  set +e
  (cd "${ROOT_DIR}" && make "${target}")
  rc=$?
  set -e
  if [[ "${rc}" -eq 0 ]]; then
    return 0
  fi
  info "${label} failed (rc=${rc}); attempting token refresh and retry once"
  (cd "${ROOT_DIR}" && BASE_URL="${BASE_URL:-http://localhost:3001}" make notebook-agent-refresh-token)
  (cd "${ROOT_DIR}" && make "${target}")
}

run_basic_smoke() {
  info "running notebook-agent-smoke-task"
  run_make_target_with_token_retry notebook-agent-smoke-task notebook-agent-smoke-task
}

run_inputrefs_loop_smoke() {
  info "running notebook-agent-inputrefs-loop-smoke"
  run_make_target_with_token_retry notebook-agent-inputrefs-loop-smoke notebook-agent-inputrefs-loop-smoke
}

run_matplotlib_smoke() {
  info "running matplotlib artifact smoke (manual API calls)"
  local token project_id agent_id api_base ws
  api_base="${API_BASE:-http://localhost:20000/api/v1}"
  ws="${WORKSPACE_ID:-ws_default}"
  token="$(cat /tmp/agentsmith_user_token.txt 2>/dev/null || true)"
  project_id="$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)"
  agent_id="$(cat /tmp/agentsmith_agent_id.txt 2>/dev/null || true)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${agent_id}" ]]; then
    err "missing token/project/agent metadata under /tmp; run demo-up or init-resources first"
    return 1
  fi
  local task_id
  task_id="$(
    curl -sS -X POST "${api_base}/workspaces/${ws}/projects/${project_id}/tasks" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data "{\"title\":\"release-mpl-smoke-$(date +%s)\",\"agent_id\":\"${agent_id}\"}" | \
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
  local failures=0
  if [[ "${RUN_BASIC_SMOKE}" == "1" ]]; then
    run_basic_smoke || failures=$((failures + 1))
  fi
  if [[ "${RUN_INPUTREFS_LOOP}" == "1" ]]; then
    run_inputrefs_loop_smoke || failures=$((failures + 1))
  fi
  if [[ "${RUN_MATPLOTLIB_SMOKE}" == "1" ]]; then
    run_matplotlib_smoke || failures=$((failures + 1))
  fi
  if [[ "${failures}" -ne 0 ]]; then
    err "release smoke completed with ${failures} failure(s)"
    exit 1
  fi
  info "release smoke completed successfully"
}

main "$@"
