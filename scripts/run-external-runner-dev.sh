#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE_ENV_PATH="${SITE_ENV_PATH:-${ROOT_DIR}/infra/deploy/demo/env/site.env.example}"
RUNNER_WS_URL="${MBOS_AGENT_WS_URL:-${RUNNER_WS_URL:-}}"
RUNNER_KEY="${MBOS_AGENT_KEY:-${RUNNER_KEY:-}}"

usage() {
  cat <<'EOF'
Usage:
  MBOS_AGENT_WS_URL='ws://.../api/v1/agent-execution/ws?...' \
  MBOS_AGENT_KEY='ask_...' \
  SITE_ENV_PATH=/path/to/site.env \
  bash scripts/run-external-runner-dev.sh

This command is the formal dev-direct path for an external runner.
It validates the same site.env schema used by deploy, renders runner env once,
and then starts the local runner source tree without building an image.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "${SITE_ENV_PATH}" ]] || {
  echo "[external-runner-dev] missing site env: ${SITE_ENV_PATH}" >&2
  exit 1
}

[[ -n "${RUNNER_WS_URL}" ]] || {
  echo "[external-runner-dev] missing MBOS_AGENT_WS_URL / RUNNER_WS_URL" >&2
  usage >&2
  exit 1
}

TMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

export DEMO_DEPLOY_ROOT="${TMP_ROOT}/deploy-root"
export RELEASE_ROOT="${TMP_ROOT}/release"
mkdir -p "${RELEASE_ROOT}/env" "${RELEASE_ROOT}/scripts/demo-deploy" "${RELEASE_ROOT}/scripts/lib"

cp "${ROOT_DIR}/infra/deploy/demo/env/site.env.example" "${RELEASE_ROOT}/env/site.env.example"
cp "${SITE_ENV_PATH}" "${RELEASE_ROOT}/env/site.env"
cp "${ROOT_DIR}/scripts/demo-deploy/resolve-runtime-addresses.sh" "${RELEASE_ROOT}/scripts/demo-deploy/resolve-runtime-addresses.sh"
cp "${ROOT_DIR}/scripts/demo-deploy/render-env.sh" "${RELEASE_ROOT}/scripts/demo-deploy/render-env.sh"
cp "${ROOT_DIR}/scripts/demo-deploy/lib/common.sh" "${RELEASE_ROOT}/scripts/lib/common.sh"
cp "${ROOT_DIR}/scripts/lib/deploy-common.sh" "${RELEASE_ROOT}/scripts/lib/deploy-common.sh"

bash "${RELEASE_ROOT}/scripts/demo-deploy/render-env.sh" >/dev/null

set -a
# shellcheck disable=SC1090
source "${RELEASE_ROOT}/env/runner.env"
set +a

export MBOS_AGENT_WS_URL="${RUNNER_WS_URL}"
export MBOS_AGENT_KEY="${RUNNER_KEY}"

cd "${ROOT_DIR}"
exec npm run agent:codex-runner
