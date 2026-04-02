#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

run_with_retry() {
  local label="$1"
  shift
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    if [[ "${attempt}" == "3" ]]; then
      echo "[notebook-terminal-matrix] ${label} failed after retries" >&2
      return 1
    fi
    echo "[notebook-terminal-matrix] retrying ${label} (${attempt}/3)" >&2
    sleep $((attempt * 2))
  done
}

bash scripts/local-manual/start-runner.sh >/dev/null
run_with_retry external_terminal_smoke bash scripts/notebook-terminal-real-smoke.sh
bash scripts/local-manual/internal-up.sh >/dev/null
run_with_retry internal_terminal_smoke env SKIP_INTERNAL_UP=1 bash scripts/notebook-terminal-internal-real-smoke.sh
