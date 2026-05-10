#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
source "${ROOT_DIR}/scripts/local-manual/common.sh"

AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE="${AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE:-developer_runner}"

echo "[agent-task-terminal-matrix] validating multi-session terminal runtime truth"

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" ]]; then
    bash "${ROOT_DIR}/scripts/local-manual/down.sh" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_on_exit $?' EXIT INT TERM

if ! local_manual_platform_is_ready; then
  echo "[agent-task-terminal-matrix] local-manual platform missing; starting it before preparing agent-task diagnostics"
  bash scripts/local-manual/up.sh >/dev/null
fi

internal_runtime_ready_for_retry() {
  local internal_status token_file state_file readiness
  internal_status="$(bash scripts/local-manual/internal-status.sh 2>/dev/null || true)"
  if ! grep -q '^Internal mode: enabled$' <<< "${internal_status}"; then
    return 1
  fi
  if ! grep -q '^Runner socket: connected$' <<< "${internal_status}"; then
    return 1
  fi

  token_file="${ROOT_DIR}/artifacts/backend-real/current/token.txt"
  state_file="${ROOT_DIR}/artifacts/backend-real/current/state.json"
  readiness="$(
    node - <<'NODE' "${token_file}" "${state_file}"
const fs = require('node:fs');
const [tokenFile, stateFile] = process.argv.slice(2);
const hasToken = (() => {
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
})();

const state = (() => {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
})();

const ready = Boolean(
  hasToken
    && typeof state?.project?.id === 'string' && state.project.id
    && typeof state?.agent_runner?.id === 'string' && state.agent_runner.id
    && state?.agent_runner?.runner_provider === 'managed',
);
process.stdout.write(ready ? 'ready' : 'missing');
NODE
  )"

  [[ "${readiness}" == "ready" ]]
}

run_internal_terminal_smoke() {
  if internal_runtime_ready_for_retry; then
    env SKIP_INTERNAL_UP=1 bash scripts/agent-task-terminal-internal-real-smoke.sh
    return 0
  fi

  echo "[agent-task-terminal-matrix] internal state missing before retry; rebuilding local-manual internal runtime" >&2
  bash scripts/agent-task-terminal-internal-real-smoke.sh
}

run_with_retry() {
  local label="$1"
  shift
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    if [[ "${attempt}" == "3" ]]; then
      echo "[agent-task-terminal-matrix] ${label} failed after retries" >&2
      return 1
    fi
    echo "[agent-task-terminal-matrix] retrying ${label} (${attempt}/3)" >&2
    sleep $((attempt * 2))
  done
}

finish_matrix_in_final_posture() {
  case "${AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE}" in
    developer_runner|developer|external)
      echo "[agent-task-terminal-matrix] restoring developer terminal runtime posture"
      bash scripts/local-manual/internal-down.sh >/dev/null
      AGENT_RUNNER_SEED_MODE=developer_runner bash scripts/local-manual/seed-agent-task-diagnostics.sh >/dev/null
      ;;
    managed_agent_task|managed|internal)
      echo "[agent-task-terminal-matrix] keeping managed terminal runtime posture for downstream UX recovery gate"
      if ! internal_runtime_ready_for_retry; then
        AGENT_RUNNER_SEED_MODE=managed_agent_task bash scripts/local-manual/internal-up.sh >/dev/null
      fi
      ;;
    *)
      echo "[agent-task-terminal-matrix] unsupported AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE=${AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE}" >&2
      return 1
      ;;
  esac
}

AGENT_RUNNER_SEED_MODE=developer_runner bash scripts/local-manual/seed-agent-task-diagnostics.sh >/dev/null
bash scripts/local-manual/start-runner.sh >/dev/null
run_with_retry external_terminal_smoke bash scripts/agent-task-terminal-real-smoke.sh
bash scripts/local-manual/internal-up.sh >/dev/null
run_with_retry internal_terminal_smoke run_internal_terminal_smoke
finish_matrix_in_final_posture
