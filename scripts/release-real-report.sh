#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

REPORT_MD="$(real_lane_state_root)/report.md"
REPORT_JSON="$(real_lane_state_root)/report.json"

cp "$(real_lane_state_file)" "${REPORT_JSON}"
cat > "${REPORT_MD}" <<EOF
# Real Lane Report

- State file: $(real_lane_state_file)
- Workspace: $(state_get workspace.id)
- Project: $(state_get project.id)
- Endpoint: $(state_get endpoint.id)
- Agent: $(state_get agent.id)
- Last phase: $(state_get release.phase)
- Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "[release-real-report] wrote ${REPORT_MD}"
echo "[release-real-report] wrote ${REPORT_JSON}"
