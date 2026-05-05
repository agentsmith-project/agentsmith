#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

DEPLOY_ROOT="${TMP_DIR}/cluster-deploy"
CURRENT_RELEASE="${DEPLOY_ROOT}/releases/current-old"
NEXT_RELEASE="${DEPLOY_ROOT}/releases/next-release"
mkdir -p "${CURRENT_RELEASE}/env" "${NEXT_RELEASE}/env"
ln -sfn "${CURRENT_RELEASE}" "${DEPLOY_ROOT}/current"

cat > "${CURRENT_RELEASE}/VERSION" <<'EOF'
release_id=current-old
agentsmith_agent_task_runner_image=localhost:5001/mbos/agentsmith-agent-task-runner:current-old
EOF

cat > "${NEXT_RELEASE}/VERSION" <<'EOF'
release_id=next-release
agentsmith_agent_task_runner_image=localhost:5001/mbos/agentsmith-agent-task-runner:next-release
EOF

mkdir -p "${NEXT_RELEASE}/scripts/cluster-deploy" "${NEXT_RELEASE}/env"

DEPLOY_ROOT="${DEPLOY_ROOT}" RELEASE_ROOT="${NEXT_RELEASE}" ROOT_DIR="${ROOT_DIR}" bash -c '
  source "'"${ROOT_DIR}"'/scripts/cluster-deploy/lib.sh"
  carry_managed_runner_release_state
'

grep -q 'cluster-deploy/deploy-substrate.sh' "${ROOT_DIR}/scripts/cluster-deploy/upgrade.sh" && {
  echo "[cluster-upgrade-smoke] upgrade.sh must not call deploy-substrate" >&2
  exit 1
}
for forbidden in bootstrap.sh verify.sh report.sh apply-cluster-prereqs.sh; do
  if grep -q "${forbidden}" "${ROOT_DIR}/scripts/cluster-deploy/upgrade.sh"; then
    echo "[cluster-upgrade-smoke] upgrade.sh must not call ${forbidden}" >&2
    exit 1
  fi
done

grep -q 'upgrade-files-verify.sh' "${ROOT_DIR}/docs/user-guides/cluster-upgrade-operations.md" || {
  echo "[cluster-upgrade-smoke] cluster-upgrade runbook must mention upgrade-files-verify.sh" >&2
  exit 1
}
[[ -f "${ROOT_DIR}/scripts/cluster-deploy/upgrade-files-verify.sh" ]] || {
  echo "[cluster-upgrade-smoke] missing upgrade-files-verify.sh" >&2
  exit 1
}

services="$(bash -lc 'source "'"${ROOT_DIR}"'/scripts/app/deploy-common.sh"; release_app_upgrade_services')"
printf '%s\n' "${services}" | grep -qx api
printf '%s\n' "${services}" | grep -qx web
printf '%s\n' "${services}" | grep -qx universal-proxy
if printf '%s\n' "${services}" | grep -Eq '^(postgres|mongo|redis|minio|keycloak)$'; then
  echo "[cluster-upgrade-smoke] upgrade services must not include substrate" >&2
  exit 1
fi

echo "[cluster-upgrade-smoke] ok"
