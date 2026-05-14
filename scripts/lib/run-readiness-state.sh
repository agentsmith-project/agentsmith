#!/usr/bin/env bash

readiness_state_field_ready() {
  local field="${1:?readiness field is required}"
  local helper_root="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  (
    cd "${helper_root}" && \
      npx tsx scripts/governance/run-readiness-state.ts check --field "${field}"
  ) >/dev/null 2>&1
}
