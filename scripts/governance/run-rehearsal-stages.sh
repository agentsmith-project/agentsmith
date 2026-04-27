#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STAGES=(reset up bootstrap verify report)

if [[ "$#" -ne 1 ]]; then
  cat >&2 <<'EOF'
usage: scripts/governance/run-rehearsal-stages.sh <demo-rehearsal|cluster-rehearsal>
EOF
  exit 2
fi

REHEARSAL_LINE="$1"
case "${REHEARSAL_LINE}" in
  demo-rehearsal)
    DEFAULT_GATE_ID="lane-demo-rehearsal"
    DEFAULT_LINE_KIND="demo_rehearsal"
    DEFAULT_NPM_SCRIPT="lane:demo-rehearsal"
    ;;
  cluster-rehearsal)
    DEFAULT_GATE_ID="lane-cluster-rehearsal"
    DEFAULT_LINE_KIND="cluster_rehearsal"
    DEFAULT_NPM_SCRIPT="lane:cluster-rehearsal"
    ;;
  *)
    printf '[rehearsal-stages] unknown rehearsal line\n' >&2
    exit 2
    ;;
esac

STAGE_ROOT="${CURRENT_REHEARSAL_STAGE_ROOT:-${ROOT_DIR}/scripts/scenarios/${REHEARSAL_LINE}}"
RUN_ROOT="${CURRENT_GATE_RESULT_EVIDENCE_DIR:-}"
RUN_ID="${CURRENT_GATE_RESULT_RUN_ID:-}"
GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-${DEFAULT_GATE_ID}}"
LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-${DEFAULT_LINE_KIND}}"
NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-${DEFAULT_NPM_SCRIPT}}"
CI_JOB="${CURRENT_GATE_RESULT_CI_JOB:-}"

diagnostic_timestamp() {
  node -e 'const now = new Date(); process.stdout.write(`${now.toISOString()} ${now.getTime()}`);'
}

write_stage_diagnostics() {
  local action="$1"
  local stage="$2"
  local event="${3:-}"
  local started_at="${4:-}"
  local started_ms="${5:-}"
  local finished_at="${6:-}"
  local finished_ms="${7:-}"

  if [[ -z "${RUN_ROOT}" || -z "${RUN_ID}" ]]; then
    printf '[rehearsal-stages] warning: missing gate diagnostics context for stage %s\n' "${stage}" >&2
    return 0
  fi

  CURRENT_RUN_DIAGNOSTICS_ACTION="${action}" \
  CURRENT_RUN_DIAGNOSTICS_RUN_ROOT="${RUN_ROOT}" \
  CURRENT_RUN_DIAGNOSTICS_RUN_ID="${RUN_ID}" \
  CURRENT_RUN_DIAGNOSTICS_GATE_ID="${GATE_ID}" \
  CURRENT_RUN_DIAGNOSTICS_LINE_KIND="${LINE_KIND}" \
  CURRENT_RUN_DIAGNOSTICS_NPM_SCRIPT="${NPM_SCRIPT}" \
  CURRENT_RUN_DIAGNOSTICS_CI_JOB="${CI_JOB}" \
  CURRENT_RUN_DIAGNOSTICS_STAGE="${stage}" \
  CURRENT_RUN_DIAGNOSTICS_EVENT="${event}" \
  CURRENT_RUN_DIAGNOSTICS_STARTED_AT="${started_at}" \
  CURRENT_RUN_DIAGNOSTICS_STARTED_MS="${started_ms}" \
  CURRENT_RUN_DIAGNOSTICS_FINISHED_AT="${finished_at}" \
  CURRENT_RUN_DIAGNOSTICS_FINISHED_MS="${finished_ms}" \
  node --import tsx "${ROOT_DIR}/scripts/governance/run-diagnostics-writer.ts"
}

for stage in "${STAGES[@]}"; do
  stage_script="${STAGE_ROOT}/${stage}.sh"
  started_at=""
  started_ms=""
  if diagnostic_now="$(diagnostic_timestamp)"; then
    started_at="${diagnostic_now% *}"
    started_ms="${diagnostic_now##* }"
  else
    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    started_ms="0"
  fi

  if ! write_stage_diagnostics "rehearsal-stage-start" "${stage}" "" "${started_at}" "${started_ms}"; then
    printf '[rehearsal-stages] warning: failed to write %s start diagnostics\n' "${stage}" >&2
  fi

  set +e
  bash "${stage_script}"
  status=$?
  set -e

  finished_at=""
  finished_ms=""
  if diagnostic_now="$(diagnostic_timestamp)"; then
    finished_at="${diagnostic_now% *}"
    finished_ms="${diagnostic_now##* }"
  else
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    finished_ms="${started_ms}"
  fi

  if [[ "${status}" -eq 0 ]]; then
    if ! write_stage_diagnostics "rehearsal-stage-finish" "${stage}" "finished" "${started_at}" "${started_ms}" "${finished_at}" "${finished_ms}"; then
      printf '[rehearsal-stages] warning: failed to write %s finish diagnostics\n' "${stage}" >&2
    fi
  else
    if ! write_stage_diagnostics "rehearsal-stage-finish" "${stage}" "failed" "${started_at}" "${started_ms}" "${finished_at}" "${finished_ms}"; then
      printf '[rehearsal-stages] warning: failed to write %s failure diagnostics\n' "${stage}" >&2
    fi
    exit "${status}"
  fi
done
