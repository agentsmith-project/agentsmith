#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_MAX_OLD_SPACE_SIZE="${NEXT_MAX_OLD_SPACE_SIZE:-4096}"

if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
else
  export NODE_OPTIONS="--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
fi

running_processes="$(pgrep -af "next-server|next dev" || true)"
if [[ -n "${running_processes}" ]]; then
  running_count="$(
    printf '%s\n' "${running_processes}" \
      | { grep -F "${ROOT_DIR}" || true; } \
      | { grep -v "run-next-dev-safe.sh" || true; } \
      | wc -l \
      | tr -d ' '
  )"
else
  running_count="0"
fi

if [[ "${running_count}" -ge 2 ]]; then
  cat >&2 <<EOF
[next-dev-safe] warning: detected ${running_count} Next.js dev processes for this workspace.
[next-dev-safe] This repo has previously hit host OOM when multiple dev servers ran in parallel.
[next-dev-safe] Consider stopping unused dev servers before continuing.
EOF
fi

exec next dev "$@"
