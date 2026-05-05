#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[feishu-real-credential-gate] $*"; }

info "checking active workspace/user Feishu connection"
(cd "${ROOT_DIR}" && bash scripts/manual-feishu-check.sh)

info "running runner-side credential regression tests"
(cd "${ROOT_DIR}" && python3 -m unittest packages/agent-task-runner/builtin-skills/feishu-docs/scripts/feishu_mcp_test.py)
(cd "${ROOT_DIR}" && npm test -- packages/api-entry-node/src/third-party-credential-files.test.ts)

info "feishu real credential gate passed"
