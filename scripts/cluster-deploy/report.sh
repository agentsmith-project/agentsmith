#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

REPORT_JSON="${REPORT_DIR}/${RELEASE_ID}.json"
REPORT_MD="${REPORT_DIR}/${RELEASE_ID}.md"
write_release_report "AgentSmith Cluster Deploy Report" "${REPORT_JSON}" "${REPORT_MD}" "- sources: ${RELEASE_ROOT}/sources
"
