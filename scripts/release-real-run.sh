#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

GLM_API_KEY_VALUE="${GLM_API_KEY:-}"
if [[ -z "${GLM_API_KEY_VALUE}" ]]; then
  echo "[release-real-run] Missing GLM_API_KEY." >&2
  exit 1
fi

info() { echo "[release-real-run] $*"; }

info "running external mainline real lane"
(cd "${ROOT_DIR}" && GLM_API_KEY="${GLM_API_KEY_VALUE}" npm run test:mainline:strict:real)

info "running notebook real smoke"
(cd "${ROOT_DIR}" && GLM_API_KEY="${GLM_API_KEY_VALUE}" npm run test:smoke:real:notebook-mainline)

info "running external codex real lane"
(cd "${ROOT_DIR}" && GLM_API_KEY="${GLM_API_KEY_VALUE}" npm run test:agents:real:codex)

info "running file library real gate"
(cd "${ROOT_DIR}" && GLM_API_KEY="${GLM_API_KEY_VALUE}" bash scripts/run-file-library-real-gate.sh)

info "running internal notebook real gate"
(cd "${ROOT_DIR}" && GLM_API_KEY="${GLM_API_KEY_VALUE}" npm run test:internal:real:notebook-workspace)

state_set_string release.phase "run_completed"
state_set_string release.last_run_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[release-real-run] done"
