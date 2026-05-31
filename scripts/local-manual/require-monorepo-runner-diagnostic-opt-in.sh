#!/usr/bin/env bash
set -euo pipefail

entrypoint="${1:-npm run agent:task-runner}"

if [[ "${AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC:-}" == "1" ]]; then
  exit 0
fi

{
  printf '[agentsmith] %s is a pre-GA transition-only monorepo runner diagnostic.\n' "${entrypoint}"
  printf '[agentsmith] Normal runtime/release path consumes the agentsmith-runner image/manifest/lock.\n'
  printf '[agentsmith] For owner diagnostics only, rerun with AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1.\n'
} >&2

exit 2
