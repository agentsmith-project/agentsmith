#!/usr/bin/env bash
set -euo pipefail
FLOW=admin_verify bash "$(cd "$(dirname "$0")" && pwd)/feishu-real-manual-step.sh"
