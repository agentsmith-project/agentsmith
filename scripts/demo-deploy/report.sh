#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

REPORT_JSON="${REPORT_DIR}/${RELEASE_ID}.json"
REPORT_MD="${REPORT_DIR}/${RELEASE_ID}.md"
write_release_report "AgentSmith Demo Deploy Report" "${REPORT_JSON}" "${REPORT_MD}"
