#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

printf '[runtime-status-smoke] inactive scenario reports inactive probes\n'
DEMO_STATUS="$(
  SCENARIO_RUNTIME_ROOT="${TMP_DIR}/runtime" \
  ACTIVE_SCENARIO_LOCK_FILE="${TMP_DIR}/runtime/active-scenario.lock" \
  bash "${ROOT_DIR}/scripts/demo-rehearsal-status.sh"
)"
printf '%s\n' "${DEMO_STATUS}" | grep -q '^Web: inactive$'
printf '%s\n' "${DEMO_STATUS}" | grep -q '^API: inactive$'
printf '%s\n' "${DEMO_STATUS}" | grep -q '^Keycloak: inactive$'
printf '%s\n' "${DEMO_STATUS}" | grep -q '^Sandbox: inactive$'

printf '[runtime-status-smoke] active scenario reports live probe codes\n'
mkdir -p "${TMP_DIR}/runtime"
printf 'demo-rehearsal\n' > "${TMP_DIR}/runtime/active-scenario.lock"
DEMO_ACTIVE_STATUS="$(
  SCENARIO_RUNTIME_ROOT="${TMP_DIR}/runtime" \
  ACTIVE_SCENARIO_LOCK_FILE="${TMP_DIR}/runtime/active-scenario.lock" \
  bash "${ROOT_DIR}/scripts/demo-rehearsal-status.sh"
)"
printf '%s\n' "${DEMO_ACTIVE_STATUS}" | grep -q '^Web: '
if printf '%s\n' "${DEMO_ACTIVE_STATUS}" | grep -q '^Web: inactive$'; then
  echo '[runtime-status-smoke] expected active scenario to probe live endpoint status' >&2
  exit 1
fi

printf '[runtime-status-smoke] ok\n'
