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
EOF

cat > "${CURRENT_RELEASE}/env/runner-runtime.env" <<'EOF'
MBOS_AGENT_WS_URL=ws://runner.example/ws
MBOS_AGENT_KEY=runner-key
EOF

cat > "${NEXT_RELEASE}/VERSION" <<'EOF'
release_id=next-release
EOF

mkdir -p "${NEXT_RELEASE}/scripts/cluster-deploy" "${NEXT_RELEASE}/env"

DEPLOY_ROOT="${DEPLOY_ROOT}" RELEASE_ROOT="${NEXT_RELEASE}" ROOT_DIR="${ROOT_DIR}" bash -c '
  source "'"${ROOT_DIR}"'/scripts/cluster-deploy/lib.sh"
  copy_runner_runtime_env_from_current_release
  [[ -f "'"${NEXT_RELEASE}"'/env/runner-runtime.env" ]] || exit 1
  grep -q "^MBOS_AGENT_WS_URL=ws://runner.example/ws$" "'"${NEXT_RELEASE}"'/env/runner-runtime.env"
  grep -q "^MBOS_AGENT_KEY=runner-key$" "'"${NEXT_RELEASE}"'/env/runner-runtime.env"
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

services="$(bash -lc 'source "'"${ROOT_DIR}"'/scripts/app/deploy-common.sh"; release_app_upgrade_services')"
printf '%s\n' "${services}" | grep -qx api
printf '%s\n' "${services}" | grep -qx web
printf '%s\n' "${services}" | grep -qx external-runner
printf '%s\n' "${services}" | grep -qx universal-proxy
if printf '%s\n' "${services}" | grep -Eq '^(postgres|mongo|redis|minio|keycloak)$'; then
  echo "[cluster-upgrade-smoke] upgrade services must not include substrate" >&2
  exit 1
fi

echo "[cluster-upgrade-smoke] ok"
