#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

bash scripts/local-manual/start-runner.sh >/dev/null
bash scripts/notebook-terminal-real-smoke.sh
bash scripts/local-manual/internal-up.sh >/dev/null
SKIP_INTERNAL_UP=1 bash scripts/notebook-terminal-internal-real-smoke.sh
