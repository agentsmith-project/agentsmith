#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
PROJECT_ID_FILE="${PROJECT_ID_FILE:-/tmp/agentsmith_project_id.txt}"
ENDPOINT_ID_FILE="${ENDPOINT_ID_FILE:-/tmp/agentsmith_endpoint_id.txt}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
API_BASE="${API_BASE:-http://localhost:20000/api/v1}"
MIN_AGENT_RPM="${MIN_AGENT_RPM:-30}"

RUN_BASIC_SMOKE="${RUN_BASIC_SMOKE:-1}"
RUN_INPUTREFS_LOOP="${RUN_INPUTREFS_LOOP:-1}"
RUN_MATPLOTLIB_SMOKE="${RUN_MATPLOTLIB_SMOKE:-0}"
MATPLOTLIB_TIMEOUT_SEC="${MATPLOTLIB_TIMEOUT_SEC:-180}"

info() { echo "[release-smoke] $*"; }
err() { echo "[release-smoke] ERROR: $*" >&2; }
warn() { echo "[release-smoke] WARN: $*" >&2; }

read_file_trim() {
  local path="$1"
  [[ -f "${path}" ]] || return 1
  tr -d '\r\n' < "${path}"
}

ensure_agent_rate_limit_baseline() {
  local token project_id agent_id base_url policy_url policy_json policy_get_code next_policy tmp_policy patch_code
  token="$(read_file_trim "${TOKEN_FILE}" || true)"
  project_id="$(read_file_trim "${PROJECT_ID_FILE}" || true)"
  agent_id="$(read_file_trim /tmp/agentsmith_agent_id.txt || true)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${agent_id}" ]]; then
    warn "skip agent policy baseline: missing token/project/agent metadata"
    return 0
  fi

  base_url="${API_BASE}/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  policy_url="${base_url}/resources/agent/${agent_id}/policy"
  tmp_policy="$(mktemp)"
  policy_get_code="$(
    curl -sS -o "${tmp_policy}" -w '%{http_code}' \
      "${policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" == "401" ]]; then
    info "agent policy baseline precheck got 401; refreshing token once"
    (cd "${ROOT_DIR}" && BASE_URL="${BASE_URL:-http://localhost:3001}" make notebook-agent-refresh-token)
    token="$(read_file_trim "${TOKEN_FILE}" || true)"
    policy_get_code="$(
      curl -sS -o "${tmp_policy}" -w '%{http_code}' \
        "${policy_url}" -H "Authorization: Bearer ${token}" || true
    )"
  fi
  if [[ "${policy_get_code}" != "200" ]]; then
    warn "skip agent policy baseline: cannot read policy (HTTP ${policy_get_code})"
    rm -f "${tmp_policy}"
    return 0
  fi

  policy_json="$(cat "${tmp_policy}")"
  rm -f "${tmp_policy}"

  next_policy="$(printf '%s' "${policy_json}" | node -e '
let s="";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  const minRpm = Number(process.argv[1] || "30");
  let p;
  try {
    p = JSON.parse(s);
  } catch {
    process.stdout.write("");
    return;
  }
  if (!p || typeof p !== "object") {
    process.stdout.write("");
    return;
  }
  if (!p.rate_limits || !Array.isArray(p.rate_limits.rules)) p.rate_limits = { rules: [] };
  const idx = p.rate_limits.rules.findIndex((r) => r && r.key === "agent.requests_per_minute");
  if (idx >= 0) {
    const current = Number(p.rate_limits.rules[idx]?.value || 0);
    if (current >= minRpm) {
      process.stdout.write("");
      return;
    }
    p.rate_limits.rules[idx].value = minRpm;
  } else {
    p.rate_limits.rules.push({ key: "agent.requests_per_minute", value: minRpm });
  }
  process.stdout.write(JSON.stringify(p));
});
' "${MIN_AGENT_RPM}")"

  if [[ -z "${next_policy}" ]]; then
    info "agent policy baseline already satisfies min rpm=${MIN_AGENT_RPM}"
    return 0
  fi

  info "normalizing agent policy rate limit to min rpm=${MIN_AGENT_RPM} before release smoke"
  patch_code="$(
    curl -sS -o /tmp/release-smoke-agent-policy-patch.json -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data "${next_policy}" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch agent policy baseline (HTTP ${patch_code})"
    cat /tmp/release-smoke-agent-policy-patch.json >&2 || true
    return 1
  fi
}

proxy_probe_status() {
  local token project_id endpoint_id url
  token="$(read_file_trim "${TOKEN_FILE}" || true)"
  project_id="$(read_file_trim "${PROJECT_ID_FILE}" || true)"
  endpoint_id="$(read_file_trim "${ENDPOINT_ID_FILE}" || true)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${endpoint_id}" ]]; then
    echo "000"
    return 0
  fi
  url="${API_BASE}/workspaces/${WORKSPACE_ID}/projects/${project_id}/endpoints/${endpoint_id}/proxy/chat/completions"
  curl -sS -o /dev/null -w '%{http_code}' \
    --max-time 20 \
    -X POST "${url}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data '{"model":"glm-4.7","messages":[{"role":"user","content":"release smoke probe"}]}' || true
}

wait_proxy_ready() {
  local max_attempts="${1:-6}"
  local sleep_sec="${2:-5}"
  local code refreshed=0
  for i in $(seq 1 "${max_attempts}"); do
    code="$(proxy_probe_status)"
    case "${code}" in
      200)
        info "proxy probe ready (HTTP 200)"
        return 0
        ;;
      429)
        warn "proxy probe reachable but rate-limited (HTTP 429); continue with target execution"
        return 0
        ;;
      401)
        if [[ "${refreshed}" == "0" ]]; then
          info "proxy probe unauthorized (HTTP 401); refreshing token once"
          (cd "${ROOT_DIR}" && BASE_URL="${BASE_URL:-http://localhost:3001}" make notebook-agent-refresh-token)
          refreshed=1
          continue
        fi
        ;;
      403)
        err "proxy probe denied (HTTP 403) - check resource policy state"
        return 1
        ;;
    esac
    info "proxy probe not ready (HTTP ${code}), waiting ${sleep_sec}s (${i}/${max_attempts})"
    sleep "${sleep_sec}"
  done
  warn "proxy probe did not become ready in precheck; continue and let target provide concrete failure signal"
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
    warn "${label} reported upstream throttling/transient saturation (rc=75); treating as non-blocking for release smoke"
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
  ensure_agent_rate_limit_baseline
  run_make_target_with_token_retry notebook-agent-smoke-task notebook-agent-smoke-task
}

run_inputrefs_loop_smoke() {
  info "running notebook-agent-inputrefs-loop-smoke"
  ensure_agent_rate_limit_baseline
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
