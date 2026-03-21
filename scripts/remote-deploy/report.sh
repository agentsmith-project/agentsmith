#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "remote-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  source "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  source "${ROOT_DIR}/scripts/lib/common.sh"
fi

ensure_state
REPORT_JSON="${REPORT_DIR}/${RELEASE_ID}.json"
REPORT_MD="${REPORT_DIR}/${RELEASE_ID}.md"
cp "$(state_file)" "${REPORT_JSON}"
cat > "${REPORT_MD}" <<EOF
# AgentSmith Remote Deploy Report

- release: ${RELEASE_ID}
- current: ${CURRENT_LINK}
- compose: ${RELEASE_ROOT}/compose/docker-compose.yml
- state: $(state_file)
- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

\`\`\`json
$(cat "$(state_file)")
\`\`\`
EOF
log "report ok: ${REPORT_MD}"
