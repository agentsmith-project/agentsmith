#!/bin/bash
# Integration Test Script for AgentSmith
# Uses curl to verify all pages are accessible

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
LOCALES=("en-US" "zh-CN")
WORKSPACE_ID="ws_default"
PROJECT_ID="proj_001"
RETRY_ATTEMPTS="${RETRY_ATTEMPTS:-24}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-1}"
AUTO_START_WEB="${AUTO_START_WEB:-1}"
AUTO_START_TIMEOUT_SECONDS="${AUTO_START_TIMEOUT_SECONDS:-180}"
NEXT_PUBLIC_USE_MSW="${NEXT_PUBLIC_USE_MSW:-true}"
STARTED_BY_SCRIPT=0
INTEGRATION_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentsmith-integration-test.XXXXXX")"
WEB_LOG_FILE="${INTEGRATION_TMP_DIR}/web.log"
WEB_PID_FILE="${INTEGRATION_TMP_DIR}/web.pid"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

stop_pid_gracefully() {
  local pid="$1"
  local label="$2"
  local wait_seconds="${3:-5}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  echo "[integration-test] stopping ${label} pid=${pid}"
  kill "${pid}" >/dev/null 2>&1 || true
  local _i
  for _i in $(seq 1 "${wait_seconds}"); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  kill -9 "${pid}" >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  if [[ "${STARTED_BY_SCRIPT}" == "1" && -f "${WEB_PID_FILE}" ]]; then
    local pid=""
    pid="$(cat "${WEB_PID_FILE}" 2>/dev/null || true)"
    stop_pid_gracefully "${pid}" "temporary Next dev server"
  fi
  rm -rf "${INTEGRATION_TMP_DIR}"
  exit "${status}"
}
trap cleanup EXIT INT TERM

is_http_ok() {
  local url="$1"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" -L "${url}" 2>/dev/null || true)"
  [[ "${code}" == "200" ]]
}

parse_loopback_port() {
  local url="$1"
  if [[ "${url}" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)$ ]]; then
    printf '%s\n' "${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE "[\\[\\]:*]${port}[[:space:]]"; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${port}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

pick_free_port() {
  local preferred_port="$1"
  local candidate
  if ! is_port_listening "${preferred_port}"; then
    printf '%s\n' "${preferred_port}"
    return 0
  fi
  for candidate in $(seq 3010 3099); do
    if ! is_port_listening "${candidate}"; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

ensure_base_url_ready() {
  if is_http_ok "${BASE_URL}/api/public/workspaces"; then
    return 0
  fi
  if [[ "${AUTO_START_WEB}" != "1" ]]; then
    return 1
  fi

  local base_port=""
  if ! base_port="$(parse_loopback_port "${BASE_URL}")"; then
    echo "[integration-test] unable to auto-start web for non-loopback BASE_URL=${BASE_URL}" >&2
    return 1
  fi

  local web_port=""
  web_port="$(pick_free_port "${base_port}")" || {
    echo "[integration-test] unable to find a free local port for web startup" >&2
    return 1
  }
  BASE_URL="http://127.0.0.1:${web_port}"
  export BASE_URL

  echo "[integration-test] starting temporary Next dev server at ${BASE_URL}"
  (
    cd "${ROOT_DIR}"
    NEXT_PUBLIC_USE_MSW="${NEXT_PUBLIC_USE_MSW}" \
    SYSTEM_WORKSPACE_REGISTRY_MODE=memory \
    NEXT_GENERATED_ROOT_MANAGED=1 \
    NEXT_DEV_PID_FILE="${WEB_PID_FILE}" \
    NEXT_DEV_PORT="${web_port}" \
    npm run dev:test -- --port "${web_port}"
  ) >"${WEB_LOG_FILE}" 2>&1 &
  STARTED_BY_SCRIPT=1

  local started_at
  started_at="$(date +%s)"
  while true; do
    if is_http_ok "${BASE_URL}/api/public/workspaces"; then
      return 0
    fi
    if [[ -f "${WEB_PID_FILE}" ]]; then
      local pid
      pid="$(cat "${WEB_PID_FILE}" 2>/dev/null || true)"
      if [[ -n "${pid}" ]] && ! kill -0 "${pid}" >/dev/null 2>&1; then
        echo "[integration-test] temporary Next dev server exited unexpectedly" >&2
        tail -n 80 "${WEB_LOG_FILE}" >&2 || true
        return 1
      fi
    fi
    if (( "$(date +%s)" - started_at >= AUTO_START_TIMEOUT_SECONDS )); then
      echo "[integration-test] timed out waiting for temporary Next dev server at ${BASE_URL}" >&2
      tail -n 80 "${WEB_LOG_FILE}" >&2 || true
      return 1
    fi
    sleep 1
  done
}

# Test function
test_url() {
  local url="$1"
  local description="$2"
  local expected_code="${3:-200}"
  local http_code=""
  local attempt=1

  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  echo -n "Testing: $description ... "

  # Next dev compiles routes on demand; give the page a short window to settle
  # before treating a transient 404/500 as a real accessibility failure.
  while [ "$attempt" -le "$RETRY_ATTEMPTS" ]; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -L "$url")
    if [ "$http_code" = "$expected_code" ]; then
      break
    fi
    if [ "$attempt" -lt "$RETRY_ATTEMPTS" ]; then
      sleep "$RETRY_DELAY_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  if [ "$http_code" = "$expected_code" ]; then
    echo -e "${GREEN}PASS${NC} (HTTP $http_code)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
    return 0
  else
    echo -e "${RED}FAIL${NC} (Expected: $expected_code, Got: $http_code after $RETRY_ATTEMPTS attempts)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    return 1
  fi
}

# Print header
echo "=========================================="
echo "AgentSmith Integration Tests"
echo "=========================================="
ensure_base_url_ready
echo "Base URL: $BASE_URL"
echo ""

# Test homepage (should redirect or show login)
echo "--- Homepage Tests ---"
test_url "$BASE_URL" "Homepage" 200
test_url "$BASE_URL/" "Homepage with trailing slash" 200

for locale in "${LOCALES[@]}"; do
  echo ""
  echo "--- Locale: $locale ---"

  # Login page
  test_url "$BASE_URL/$locale/login" "Login page" 200

  # Project list page
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects" "Projects list" 200

  # Project pages
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/overview" "Project Overview" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/chat" "Chat Workspace" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/notebook" "Notebook Workspace" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/agents" "Agents Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/endpoints" "Endpoints Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/members" "Members Management" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/audit" "Audit Log" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/usage" "Usage Analytics" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/settings" "Settings" 200
  test_url "$BASE_URL/$locale/workspaces/$WORKSPACE_ID/projects/$PROJECT_ID/files" "Files" 200
done

# Test 404 handling
echo ""
echo "--- Error Handling Tests ---"
test_url "$BASE_URL/en-US/this-page-does-not-exist" "Non-existent page should return 404" 404

# Print summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Total:  $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
  echo ""
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
