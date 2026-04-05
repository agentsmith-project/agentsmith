#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

FAKE_ROOT="${TMP_DIR}/fake-root"
mkdir -p \
  "${FAKE_ROOT}/scripts/scenarios/demo-rehearsal" \
  "${FAKE_ROOT}/scripts/scenarios/cluster-rehearsal" \
  "${FAKE_ROOT}/scripts/demo-deploy" \
  "${FAKE_ROOT}/scripts/cluster-deploy"

cp "${REPO_ROOT}/scripts/scenarios/common.sh" "${FAKE_ROOT}/scripts/scenarios/common.sh"
for name in common.sh bootstrap.sh verify.sh report.sh; do
  cp "${REPO_ROOT}/scripts/scenarios/demo-rehearsal/${name}" "${FAKE_ROOT}/scripts/scenarios/demo-rehearsal/${name}"
  cp "${REPO_ROOT}/scripts/scenarios/cluster-rehearsal/${name}" "${FAKE_ROOT}/scripts/scenarios/cluster-rehearsal/${name}"
done

for stage in bootstrap verify report; do
  cat > "${FAKE_ROOT}/scripts/demo-deploy/${stage}.sh" <<STAGE
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${DEMO_DEPLOY_ROOT}/state"
printf '%s\n' "${stage}" >> "\${DEMO_DEPLOY_ROOT}/state/stages.log"
STAGE
  chmod +x "${FAKE_ROOT}/scripts/demo-deploy/${stage}.sh"

  cat > "${FAKE_ROOT}/scripts/cluster-deploy/${stage}.sh" <<STAGE
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${CLUSTER_DEPLOY_ROOT}/state"
printf '%s\n' "${stage}" >> "\${CLUSTER_DEPLOY_ROOT}/state/stages.log"
STAGE
  chmod +x "${FAKE_ROOT}/scripts/cluster-deploy/${stage}.sh"
done

for stage in prepare-admin-handoff apply-cluster-prereqs deploy-sandbox; do
  cat > "${FAKE_ROOT}/scripts/cluster-deploy/${stage}.sh" <<STAGE
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${CLUSTER_DEPLOY_ROOT}/state"
printf '%s\n' "${stage}" >> "\${CLUSTER_DEPLOY_ROOT}/state/stages.log"
STAGE
  chmod +x "${FAKE_ROOT}/scripts/cluster-deploy/${stage}.sh"
done

printf '[runtime-stage-command-smoke] demo bootstrap/verify/report on active lock\n'
SCENARIO_RUNTIME_ROOT="${TMP_DIR}/runtime" \
ACTIVE_SCENARIO_LOCK_FILE="${TMP_DIR}/runtime/active-scenario.lock" \
ROOT_DIR="${FAKE_ROOT}" \
DEMO_REHEARSAL_ROOT="${TMP_DIR}/demo-rehearsal" \
bash -lc '
  mkdir -p "${SCENARIO_RUNTIME_ROOT}"
  printf demo-rehearsal > "${ACTIVE_SCENARIO_LOCK_FILE}"
  mkdir -p "${DEMO_REHEARSAL_ROOT}/state"
  cat > "${DEMO_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"deploy_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/demo-rehearsal/bootstrap.sh"
  cat > "${DEMO_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"bootstrap_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/demo-rehearsal/verify.sh"
  cat > "${DEMO_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"verify_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/demo-rehearsal/report.sh"
'

diff -u <(printf 'bootstrap\nverify\nreport\n') "${TMP_DIR}/demo-rehearsal/state/stages.log"

printf '[runtime-stage-command-smoke] cluster bootstrap/verify/report on active lock\n'
SCENARIO_RUNTIME_ROOT="${TMP_DIR}/runtime" \
ACTIVE_SCENARIO_LOCK_FILE="${TMP_DIR}/runtime/active-scenario.lock" \
ROOT_DIR="${FAKE_ROOT}" \
CLUSTER_REHEARSAL_ROOT="${TMP_DIR}/cluster-rehearsal" \
bash -lc '
  mkdir -p "${SCENARIO_RUNTIME_ROOT}"
  printf cluster-rehearsal > "${ACTIVE_SCENARIO_LOCK_FILE}"
  mkdir -p "${CLUSTER_REHEARSAL_ROOT}/state"
  cat > "${CLUSTER_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"deploy_app_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/cluster-rehearsal/bootstrap.sh"
  cat > "${CLUSTER_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"bootstrap_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/cluster-rehearsal/verify.sh"
  cat > "${CLUSTER_REHEARSAL_ROOT}/state/deploy-state.json" <<EOF
{"release":{"phase":"verify_completed"}}
EOF
  bash "${ROOT_DIR}/scripts/scenarios/cluster-rehearsal/report.sh"
'

diff -u <(printf 'prepare-admin-handoff\napply-cluster-prereqs\ndeploy-sandbox\nbootstrap\nverify\nreport\n') "${TMP_DIR}/cluster-rehearsal/state/stages.log"

printf '[runtime-stage-command-smoke] ok\n'
