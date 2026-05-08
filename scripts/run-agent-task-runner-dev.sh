#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE_ENV_PATH="${SITE_ENV_PATH:-${ROOT_DIR}/infra/deploy/unified/env/site.env.example}"
UNIFIED_DEPLOY_PROFILE="${UNIFIED_DEPLOY_PROFILE:-local-kind}"
RUNNER_WS_URL="${MBOS_AGENT_WS_URL:-${RUNNER_WS_URL:-}}"
RUNNER_KEY="${MBOS_AGENT_KEY:-${RUNNER_KEY:-}}"

usage() {
  cat <<'EOF'
Usage:
  MBOS_AGENT_WS_URL='ws://.../api/v1/agent-execution/ws?...' \
  MBOS_AGENT_KEY='ask_...' \
  SITE_ENV_PATH=/path/to/site.env \
  bash scripts/run-agent-task-runner-dev.sh

This command is the formal dev-direct path for an agent-task runner.
It validates the same unified deploy site.env schema used by deploy,
and then starts the local runner source tree without building an image.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "${SITE_ENV_PATH}" ]] || {
  echo "[agent-task-runner-dev] missing site env: ${SITE_ENV_PATH}" >&2
  exit 1
}

[[ -n "${RUNNER_WS_URL}" ]] || {
  echo "[agent-task-runner-dev] missing MBOS_AGENT_WS_URL / RUNNER_WS_URL" >&2
  usage >&2
  exit 1
}

[[ -n "${RUNNER_KEY}" ]] || {
  echo "[agent-task-runner-dev] missing MBOS_AGENT_KEY / RUNNER_KEY" >&2
  usage >&2
  exit 1
}

TMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

export DEPLOY_ROOT="${TMP_ROOT}/deploy-root"
npx tsx "${ROOT_DIR}/scripts/unified-deploy/render.ts" \
  --profile="${UNIFIED_DEPLOY_PROFILE}" \
  --site-env="${SITE_ENV_PATH}" \
  --out="${TMP_ROOT}/unified-deploy-render.yaml" >/dev/null

export MBOS_AGENT_WS_URL="${RUNNER_WS_URL}"
export MBOS_AGENT_KEY="${RUNNER_KEY}"

cd "${ROOT_DIR}"
exec npm run agent:task-runner
