#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

REPORT_MD="$(backend_real_state_root)/report.md"
REPORT_JSON="$(backend_real_state_root)/report.json"

cp "$(backend_real_state_file)" "${REPORT_JSON}"
cat > "${REPORT_MD}" <<EOF
# Real Lane Report

- State file: $(backend_real_state_file)
- Workspace: $(state_get workspace.id)
- Project: $(state_get project.id)
- Endpoint: $(state_get endpoint.id)
- Agent: $(state_get agent.id)
- Last phase: $(state_get release.phase)
- Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "[backend-real-report] wrote ${REPORT_MD}"
echo "[backend-real-report] wrote ${REPORT_JSON}"
