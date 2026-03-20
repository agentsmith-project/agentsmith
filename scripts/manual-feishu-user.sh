#!/usr/bin/env bash
set -euo pipefail
FLOW=user_connect bash "$(cd "$(dirname "$0")" && pwd)/feishu-real-manual-step.sh"
