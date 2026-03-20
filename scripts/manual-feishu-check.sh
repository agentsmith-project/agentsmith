#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state
FLOW_VALUE="${FLOW:-$(state_get feishu.manual.flow admin_verify)}"
FLOW="${FLOW_VALUE}" bash "$(cd "$(dirname "$0")" && pwd)/feishu-real-resume-check.sh"
