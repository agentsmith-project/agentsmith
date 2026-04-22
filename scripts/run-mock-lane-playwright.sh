#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/lane-run-state.sh"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
source "${ROOT_DIR}/scripts/lib/port-utils.sh"

MOCK_RUN_ID="${MOCK_RUN_ID:-$(lane_generate_run_id mock)}"
MOCK_RUN_ROOT="${MOCK_RUN_ROOT:-$(lane_prepare_run_root mock-lane "${MOCK_RUN_ID}" current)}"
MOCK_STATE_DIR="${MOCK_STATE_DIR:-${MOCK_RUN_ROOT}}"
mkdir -p "${MOCK_STATE_DIR}"
PORT_WEB="${PORT_WEB:-3001}"
NEXT_DIST_DIR="${MOCK_NEXT_DIST_DIR:-artifacts/mock-lane/runs/${MOCK_RUN_ID}/next-dist}"
BASE_URL="http://127.0.0.1:${PORT_WEB}"
HEALTH_URL="${BASE_URL}/zh-CN/login"
WARM_URLS_DEFAULT=$'/zh-CN/login\n/en-US/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default\n/en-US/workspaces/ws_default/settings\n/en-US/user/profile\n/en-US/workspaces/ws_default/projects/proj_001/files'
WARM_ROUTE_ATTEMPTS="${MOCK_LANE_WARM_ROUTE_ATTEMPTS:-15}"

PID_FILE="${MOCK_STATE_DIR}/web.pid"
NEXT_PID_FILE="${MOCK_STATE_DIR}/next-dev.pid"
LOG_FILE="${MOCK_STATE_DIR}/web.log"
NEXT_DEV_EXIT_MARKER_FILE="${MOCK_STATE_DIR}/next-dev-exit.json"
MOCK_WORKSPACE_PROVISIONING_PATH="${MOCK_WORKSPACE_PROVISIONING_PATH:-artifacts/mock-lane/runs/${MOCK_RUN_ID}/system-workspace-provisioning.mock}"
MOCK_WORKSPACE_REGISTRY_FILE="${MOCK_WORKSPACE_REGISTRY_FILE:-artifacts/mock-lane/runs/${MOCK_RUN_ID}/system-workspaces.json}"
STARTED_BY_SCRIPT=0
LAST_PLAYWRIGHT_LOG=""
MAX_ATTEMPTS="${MOCK_LANE_MAX_ATTEMPTS:-3}"
KEEP_SUCCESS_RUN="${MOCK_LANE_KEEP_SUCCESS:-0}"
KEEP_FAILED_RUN="${MOCK_LANE_KEEP_FAILED:-1}"
PRUNE_KEEP_COUNT="${MOCK_LANE_KEEP_RECENT:-5}"
PRUNE_STALE_HOURS="${MOCK_LANE_PRUNE_STALE_HOURS:-24}"
RUN_SUCCEEDED=0
VISUAL_BUILD_INFO_FILE="${MOCK_STATE_DIR}/visual-build-info.json"
VISUAL_BASELINE_BUILD_INFO_FILE="${VISUAL_BASELINE_BUILD_INFO_FILE:-${VISUAL_BUILD_INFO_FILE}}"
VISUAL_BASELINE_BUILD_FINGERPRINT="${VISUAL_BASELINE_BUILD_FINGERPRINT:-}"
PLAYWRIGHT_WATCHDOG_SIGNAL_FILE="${MOCK_STATE_DIR}/playwright-watchdog.signal"
PLAYWRIGHT_PID=""
PLAYWRIGHT_TAIL_PID=""
PLAYWRIGHT_WATCHDOG_PID=""
next_generated_root_normalize
next_generated_root_write_lane_owner "${MOCK_RUN_ROOT}" "mock-lane" "$$" "run-mock-lane-playwright.sh"

info() { echo "[mock-lane] $*"; }
err() { echo "[mock-lane] ERROR: $*" >&2; }

log_next_dev_exit_marker() {
  [[ -f "${NEXT_DEV_EXIT_MARKER_FILE}" ]] || return 1
  local summary
  summary="$(node -e "const fs=require('node:fs'); const file=process.argv[1]; const json=JSON.parse(fs.readFileSync(file,'utf8')); const signal=json.signal === null ? 'none' : String(json.signal); const child=json.child_pid === null ? 'unknown' : String(json.child_pid); process.stdout.write(\`event=\${json.event};status=\${json.exit_status};signal=\${signal};child_pid=\${child}\`);" "${NEXT_DEV_EXIT_MARKER_FILE}" 2>/dev/null || true)"
  if [[ -n "${summary}" ]]; then
    info "next dev exit marker: ${summary}"
    return 0
  fi
  return 1
}

write_visual_build_info() {
  local git_sha started_at fingerprint existing_git_sha existing_run_id
  git_sha="$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "${git_sha}" ]]; then
    err "failed to resolve git sha for visual build metadata"
    exit 1
  fi
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  fingerprint="${VISUAL_BASELINE_BUILD_FINGERPRINT:-$(printf '%s|%s|%s|%s' "${MOCK_RUN_ID}" "${git_sha}" "${NEXT_DIST_DIR}" "${PORT_WEB}" | sha256sum | awk '{print $1}')}"

  if [[ -f "${VISUAL_BASELINE_BUILD_INFO_FILE}" ]]; then
    existing_git_sha="$(node -e "const fs=require('node:fs'); const file=process.argv[1]; const json=JSON.parse(fs.readFileSync(file,'utf8')); process.stdout.write(String(json.git_sha || ''));" "${VISUAL_BASELINE_BUILD_INFO_FILE}" 2>/dev/null || true)"
    existing_run_id="$(node -e "const fs=require('node:fs'); const file=process.argv[1]; const json=JSON.parse(fs.readFileSync(file,'utf8')); process.stdout.write(String(json.run_id || ''));" "${VISUAL_BASELINE_BUILD_INFO_FILE}" 2>/dev/null || true)"
    if [[ -n "${existing_git_sha}" && "${existing_git_sha}" != "${git_sha}" ]] || [[ -n "${existing_run_id}" && "${existing_run_id}" != "${MOCK_RUN_ID}" ]]; then
      err "stale visual build metadata detected in ${VISUAL_BASELINE_BUILD_INFO_FILE}"
      exit 1
    fi
  fi

  cat > "${VISUAL_BASELINE_BUILD_INFO_FILE}" <<EOF
{
  "lane": "mock-lane",
  "run_id": "${MOCK_RUN_ID}",
  "git_sha": "${git_sha}",
  "fingerprint": "${fingerprint}",
  "started_at": "${started_at}",
  "base_url": "${BASE_URL}",
  "next_dist_dir": "${NEXT_DIST_DIR}"
}
EOF

  VISUAL_BASELINE_BUILD_FINGERPRINT="${fingerprint}"
  export VISUAL_BASELINE_BUILD_INFO_FILE VISUAL_BASELINE_BUILD_FINGERPRINT
}

stop_pid_gracefully() {
  local pid="$1"
  local label="$2"
  local wait_seconds="${3:-5}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  info "stopping ${label} pid ${pid}"
  next_generated_root_stop_pid_tree_gracefully "${pid}" "${wait_seconds}"
}

reset_next_dev_artifacts_if_corrupt() {
  if grep -q "Cannot find module './vendor-chunks/next.js'" "${LOG_FILE}" 2>/dev/null; then
    info "detected corrupted Next.js dev artifacts; clearing ${NEXT_DIST_DIR} before retry"
    rm -rf "${ROOT_DIR}/${NEXT_DIST_DIR}"
  fi
}

cleanup() {
  if [[ -n "${PLAYWRIGHT_WATCHDOG_PID}" ]]; then
    kill "${PLAYWRIGHT_WATCHDOG_PID}" >/dev/null 2>&1 || true
    wait "${PLAYWRIGHT_WATCHDOG_PID}" >/dev/null 2>&1 || true
    PLAYWRIGHT_WATCHDOG_PID=""
  fi
  if [[ -n "${PLAYWRIGHT_TAIL_PID}" ]]; then
    kill "${PLAYWRIGHT_TAIL_PID}" >/dev/null 2>&1 || true
    wait "${PLAYWRIGHT_TAIL_PID}" >/dev/null 2>&1 || true
    PLAYWRIGHT_TAIL_PID=""
  fi
  if [[ -n "${PLAYWRIGHT_PID}" ]]; then
    kill "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
    wait "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
    PLAYWRIGHT_PID=""
  fi
  if [[ "${STARTED_BY_SCRIPT}" == "1" ]] && [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    stop_pid_gracefully "${pid}" "mock lane web"
    rm -f "${PID_FILE}"
  fi
  if [[ -f "${NEXT_PID_FILE}" ]]; then
    local next_pid
    next_pid="$(cat "${NEXT_PID_FILE}" 2>/dev/null || true)"
    stop_pid_gracefully "${next_pid}" "mock lane next"
    rm -f "${NEXT_PID_FILE}"
  fi
  next_generated_root_clear_lane_owner "${MOCK_RUN_ROOT}"
  next_generated_root_finalize_lane_cleanup
  rm -rf "${ROOT_DIR}/${MOCK_WORKSPACE_PROVISIONING_PATH}"
  if [[ "${RUN_SUCCEEDED}" == "1" ]]; then
    lane_mark_status "${MOCK_RUN_ROOT}" success
  else
    lane_mark_status "${MOCK_RUN_ROOT}" failed
  fi
  if [[ "${RUN_SUCCEEDED}" == "1" && "${KEEP_SUCCESS_RUN}" != "1" ]]; then
    rm -rf "${MOCK_RUN_ROOT}"
  elif [[ "${RUN_SUCCEEDED}" != "1" && "${KEEP_FAILED_RUN}" != "1" ]]; then
    rm -rf "${MOCK_RUN_ROOT}"
  fi
  lane_remove_current_link_if_matches mock-lane "${MOCK_RUN_ROOT}" current
  lane_prune_runs mock-lane "${PRUNE_KEEP_COUNT}" "${PRUNE_STALE_HOURS}"
}
trap cleanup EXIT

is_server_alive() {
  if [[ ! -f "${PID_FILE}" ]]; then
    port_is_listening "${PORT_WEB}"
    return $?
  fi
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    port_is_listening "${PORT_WEB}"
    return $?
  fi
  if kill -0 "${pid}" >/dev/null 2>&1; then
    if port_is_listening "${PORT_WEB}"; then
      return 0
    fi
    return 1
  fi
  port_is_listening "${PORT_WEB}"
}

stop_owned_server() {
  if [[ ! -f "${PID_FILE}" ]]; then
    return 0
  fi
  local pid=""
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  stop_pid_gracefully "${pid}" "owned mock lane server"
  rm -f "${PID_FILE}"
  if [[ -f "${NEXT_PID_FILE}" ]]; then
    local next_pid=""
    next_pid="$(cat "${NEXT_PID_FILE}" 2>/dev/null || true)"
    stop_pid_gracefully "${next_pid}" "owned mock lane next"
    rm -f "${NEXT_PID_FILE}"
  fi
}

cleanup_stale_mock_processes() {
  local pid_file pid cmd run_root run_status stale_cutoff
  stale_cutoff="$(( $(date +%s) - (PRUNE_STALE_HOURS * 3600) ))"
  while IFS= read -r pid_file; do
    [[ -n "${pid_file}" ]] || continue
    run_root="$(dirname "${pid_file}")"
    run_status="$(lane_read_status "${run_root}")"
    if [[ "${run_status}" != "incomplete" ]]; then
      continue
    fi
    if [[ "$(stat -c '%Y' "${run_root}" 2>/dev/null || printf '0')" -ge "${stale_cutoff}" ]]; then
      continue
    fi
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    [[ -n "${pid}" ]] || continue
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      rm -f "${pid_file}"
      continue
    fi
    cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ "${cmd}" == *"npm run dev:test"* || "${cmd}" == *"run-next-dev-safe.sh"* || "${cmd}" == *"next dev"* ]]; then
      stop_pid_gracefully "${pid}" "stale mock-lane web process"
      rm -f "${pid_file}"
    fi
  done < <(find "$(lane_runs_root mock-lane)" -mindepth 2 -maxdepth 2 \( -type f -name 'web.pid' -o -type f -name 'next-dev.pid' \) 2>/dev/null | sort -u)

  lane_prune_runs mock-lane "${PRUNE_KEEP_COUNT}" "${PRUNE_STALE_HOURS}"
}

pick_free_port() {
  local candidate="${PORT_WEB}"
  if port_is_bindable "${candidate}"; then
    echo "${candidate}"
    return 0
  fi

  for candidate in $(seq 3010 3099); do
    if port_is_bindable "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

rebind_urls_for_port() {
  local port="$1"
  PORT_WEB="${port}"
  BASE_URL="http://127.0.0.1:${PORT_WEB}"
  HEALTH_URL="${BASE_URL}/zh-CN/login"
}

wait_http_ok() {
  local max="${1:-120}"
  local i
  for i in $(seq 1 "${max}"); do
    if [[ "${STARTED_BY_SCRIPT}" == "1" ]] && [[ -f "${PID_FILE}" ]]; then
      local pid
      pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
      if [[ -n "${pid}" ]] && ! kill -0 "${pid}" >/dev/null 2>&1 && ! port_is_listening "${PORT_WEB}"; then
        return 1
      fi
    fi
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_stable_health() {
  local consecutive_target="${1:-2}"
  local consecutive=0
  local max_checks="${2:-30}"
  local i
  for i in $(seq 1 "${max_checks}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then
      consecutive=$((consecutive + 1))
      if [[ "${consecutive}" -ge "${consecutive_target}" ]]; then
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 1
  done
  return 1
}

warm_route() {
  local route="$1"
  local attempts="${2:-${WARM_ROUTE_ATTEMPTS}}"
  local i
  for i in $(seq 1 "${attempts}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}${route}" 2>/dev/null || true)"
    if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
      return 0
    fi
    sleep 1
  done
  info "route ${route} did not warm successfully after ${attempts} attempts"
  return 1
}

warm_routes() {
  local warm_routes_raw="${MOCK_LANE_WARM_URLS:-${WARM_URLS_DEFAULT}}"
  local warmed_any=0
  while IFS= read -r route; do
    [[ -z "${route}" ]] && continue
    warmed_any=1
    info "warming route ${route}"
    warm_route "${route}" || return 1
  done <<< "${warm_routes_raw}"

  if [[ "${warmed_any}" == "1" ]]; then
    info "verifying mock web stability after route warm-up"
    wait_for_stable_health 2 20 || return 1
  fi
}

start_mock_server() {
  local launch_attempt=1
  while [[ "${launch_attempt}" -le 3 ]]; do
    rm -rf "${ROOT_DIR}/${MOCK_WORKSPACE_PROVISIONING_PATH}"
    rm -f "${NEXT_DEV_EXIT_MARKER_FILE}"

    if ! port_is_bindable "${PORT_WEB}"; then
      info "port :${PORT_WEB} is busy; finding an alternate free port for this mock lane"
      fallback_port="$(pick_free_port || true)"
      if [[ -z "${fallback_port}" ]]; then
        err "failed to find a free port for mock lane"
        exit 1
      fi
      rebind_urls_for_port "${fallback_port}"
      info "using fallback port :${PORT_WEB}"
    fi

    info "starting mock web server on :${PORT_WEB} (log: ${LOG_FILE}) [attempt ${launch_attempt}/3]"
    if [[ "${launch_attempt}" -eq 1 ]]; then
      : > "${LOG_FILE}"
    fi
    printf '\n[mock-lane] ===== launch attempt %s/%s on :%s =====\n' "${launch_attempt}" "3" "${PORT_WEB}" >> "${LOG_FILE}"
    rm -rf "${ROOT_DIR}/${NEXT_DIST_DIR}"
    (
      cd "${ROOT_DIR}"
      exec env \
        MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
        MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
        NEXT_MAX_OLD_SPACE_SIZE="${NEXT_MAX_OLD_SPACE_SIZE:-6144}" \
        NEXT_DIST_DIR="${NEXT_DIST_DIR}" \
        NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${MOCK_RUN_ROOT}" \
        NEXT_GENERATED_ROOT_MANAGED=1 \
        NEXT_DEV_PID_FILE="${NEXT_PID_FILE}" \
        NEXT_DEV_EXIT_MARKER_FILE="${NEXT_DEV_EXIT_MARKER_FILE}" \
        NEXT_PUBLIC_USE_MSW=true \
        NEXT_PUBLIC_MSW_STRICT_READY=true \
        AGENTSMITH_ENABLE_TEST_ROUTES=true \
        SYSTEM_WORKSPACE_REGISTRY_MODE=file \
        SYSTEM_WORKSPACE_REGISTRY_FILE="${MOCK_WORKSPACE_REGISTRY_FILE}" \
        SYSTEM_WORKSPACE_PROVISIONING_PATH="${MOCK_WORKSPACE_PROVISIONING_PATH}" \
        bash scripts/run-next-dev-safe.sh --port "${PORT_WEB}"
    ) >>"${LOG_FILE}" 2>&1 &
    echo $! > "${PID_FILE}"
    STARTED_BY_SCRIPT=1

    if wait_http_ok 120; then
      if ! warm_routes; then
        info "mock web responded to health checks but did not stabilize after route warm-up"
      else
        return 0
      fi
    fi

    if wait_http_ok 20 && warm_routes; then
      return 0
    fi

    if [[ "${launch_attempt}" -ge 3 ]]; then
      err "web server is not ready at ${HEALTH_URL}"
      tail -n 120 "${LOG_FILE}" 2>/dev/null || true
      exit 1
    fi

    info "mock web server failed to become ready; restarting lane bootstrap (${launch_attempt}/3)"
    log_next_dev_exit_marker || true
    stop_owned_server
    reset_next_dev_artifacts_if_corrupt
    if ! port_wait_for_release "${PORT_WEB}" 15; then
      info "port :${PORT_WEB} did not release after stop; finding a fallback port for the retry"
      fallback_port="$(pick_free_port || true)"
      if [[ -z "${fallback_port}" ]]; then
        err "failed to find a free port for mock lane after restart cleanup"
        exit 1
      fi
      rebind_urls_for_port "${fallback_port}"
      info "using fallback port :${PORT_WEB} after restart cleanup"
    fi
    launch_attempt=$((launch_attempt + 1))
  done
}

run_playwright_once() {
  LAST_PLAYWRIGHT_LOG="$(mktemp "${MOCK_STATE_DIR}/playwright.XXXXXX.log")"
  rm -f "${PLAYWRIGHT_WATCHDOG_SIGNAL_FILE}"
  : > "${LAST_PLAYWRIGHT_LOG}"
  (
    cd "${ROOT_DIR}"
    env \
      PW_EXCLUDE_LANE_REAL=true \
      BASE_URL="${BASE_URL}" \
      NEXT_PUBLIC_USE_MSW=true \
      NEXT_PUBLIC_MSW_STRICT_READY=true \
      VISUAL_BASELINE_BUILD_INFO_FILE="${VISUAL_BASELINE_BUILD_INFO_FILE}" \
      VISUAL_BASELINE_BUILD_FINGERPRINT="${VISUAL_BASELINE_BUILD_FINGERPRINT}" \
      npx playwright test "$@"
  ) >"${LAST_PLAYWRIGHT_LOG}" 2>&1 &
  PLAYWRIGHT_PID=$!

  tail --pid="${PLAYWRIGHT_PID}" -n +1 -f "${LAST_PLAYWRIGHT_LOG}" &
  PLAYWRIGHT_TAIL_PID=$!

  (
    while kill -0 "${PLAYWRIGHT_PID}" >/dev/null 2>&1; do
      sleep 2
      if ! port_is_listening "${PORT_WEB}"; then
        printf 'listener_lost\n' > "${PLAYWRIGHT_WATCHDOG_SIGNAL_FILE}"
        info "mock lane web on :${PORT_WEB} stopped listening during playwright execution; terminating current attempt for retry"
        kill -TERM "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
        sleep 2
        kill -KILL "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
        exit 0
      fi
    done
  ) &
  PLAYWRIGHT_WATCHDOG_PID=$!

  set +e
  wait "${PLAYWRIGHT_PID}"
  local exit_code=$?
  set -e

  kill "${PLAYWRIGHT_WATCHDOG_PID}" >/dev/null 2>&1 || true
  wait "${PLAYWRIGHT_WATCHDOG_PID}" >/dev/null 2>&1 || true
  PLAYWRIGHT_WATCHDOG_PID=""

  wait "${PLAYWRIGHT_TAIL_PID}" >/dev/null 2>&1 || true
  PLAYWRIGHT_TAIL_PID=""
  PLAYWRIGHT_PID=""

  return "${exit_code}"
}

did_playwright_watchdog_trip() {
  [[ -s "${PLAYWRIGHT_WATCHDOG_SIGNAL_FILE}" ]]
}

is_transient_playwright_failure() {
  [[ -n "${LAST_PLAYWRIGHT_LOG}" ]] && grep -Eq \
    'ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ECONNRESET|EPIPE|socket hang up|Target closed' \
    "${LAST_PLAYWRIGHT_LOG}"
}

is_visual_baseline_run() {
  local arg
  for arg in "$@"; do
    if [[ "${arg}" == "e2e/visual.spec.ts" ]]; then
      return 0
    fi
  done
  return 1
}
cleanup_stale_mock_processes
start_mock_server
write_visual_build_info

attempt=1
while [[ "${attempt}" -le "${MAX_ATTEMPTS}" ]]; do
  if run_playwright_once "$@"; then
    if is_visual_baseline_run "$@"; then
      (cd "${ROOT_DIR}" && npx tsx scripts/governance/write-visual-baseline-reviews.ts)
    fi
    RUN_SUCCEEDED=1
    exit 0
  fi

  if [[ "${attempt}" -ge "${MAX_ATTEMPTS}" ]]; then
    break
  fi

  if did_playwright_watchdog_trip || is_transient_playwright_failure || ! is_server_alive; then
    log_next_dev_exit_marker || true
    info "detected transient web/execution-service failure; restarting mock lane and retrying (${attempt}/${MAX_ATTEMPTS})"
    stop_owned_server
    start_mock_server
    attempt=$((attempt + 1))
    continue
  fi
  break
done

exit 1
