#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

if [[ "$#" -lt 5 || "$4" != "--" ]]; then
  cat >&2 <<'EOF'
usage: scripts/run-current-gate-result-wrapped.sh <gate-id> <line-kind> <npm-script> -- <command> [args...]
EOF
  exit 2
fi

GATE_ID="$1"
LINE_KIND="$2"
NPM_SCRIPT="$3"
shift 4

RUN_ID="${CURRENT_GATE_RESULT_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${CURRENT_GATE_RESULT_EVIDENCE_DIR:-${ROOT_DIR}/artifacts/gate-results/${GATE_ID}/${RUN_ID}}"
export CURRENT_GATE_RESULT_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-${GATE_ID}}"
export CURRENT_GATE_RESULT_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-${NPM_SCRIPT}}"
export CURRENT_GATE_RESULT_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-${LINE_KIND}}"

gate_evidence_init "${EVIDENCE_DIR}" "${LINE_KIND}"
gate_record_task_summary "${EVIDENCE_DIR}" "{\"line_kind\":\"${LINE_KIND}\",\"gate_id\":\"${GATE_ID}\",\"npm_script\":\"${NPM_SCRIPT}\"}"

set +e
"$@"
status=$?
set -e

if [[ "${status}" -eq 0 ]]; then
  gate_record_success "${EVIDENCE_DIR}" "${LINE_KIND}"
  exit 0
fi

gate_record_failure "${EVIDENCE_DIR}" "${CURRENT_GATE_RESULT_FAILURE_CLASSIFICATION:-scenario_assertion_failed}" "execute" "wrapped command exited with status ${status}"
exit "${status}"
