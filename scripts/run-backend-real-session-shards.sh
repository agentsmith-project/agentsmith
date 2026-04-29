#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

exec bash "${ROOT_DIR}/scripts/run-integration-e2e-full.sh" --session agents-backend-real-runner
