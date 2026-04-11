#!/usr/bin/env bash

next_generated_root_repo_dir() {
  printf '%s\n' "${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
}

next_generated_root_canonical_next_env() {
  cat <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF
}

next_generated_root_normalize() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"

  node - <<'NODE' "${repo_dir}/tsconfig.json"
const fs = require('node:fs');
const tsconfigPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
const originalInclude = Array.isArray(config.include)
  ? config.include.filter((entry) => typeof entry === 'string')
  : [];

const requiredPatterns = [
  '.next*/types/**/*.ts',
  'artifacts/backend-real/current-run/next-dist/types/**/*.ts',
  'artifacts/mock-lane/current/next-dist/types/**/*.ts',
];

const managedEntryPattern =
  /(?:^|\/)(?:mock|integration)-\d{8}T\d{6}Z-\d+-\d+(?:\/|$)|\.next-backend-real-|\.next-mock-|\/next-dist\/types\//;

const filtered = originalInclude.filter((entry) => !managedEntryPattern.test(entry));
const deduped = [];
for (const entry of filtered) {
  if (!deduped.includes(entry)) {
    deduped.push(entry);
  }
}

const normalizedInclude = [];
for (const pattern of requiredPatterns) {
  if (!normalizedInclude.includes(pattern)) {
    normalizedInclude.push(pattern);
  }
}
for (const entry of deduped) {
  if (!normalizedInclude.includes(entry)) {
    normalizedInclude.push(entry);
  }
}

config.include = normalizedInclude;
fs.writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

  next_generated_root_canonical_next_env > "${repo_dir}/next-env.d.ts"
}

next_generated_root_stop_pid_tree_gracefully() {
  local pid="$1"
  local wait_seconds="${2:-5}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  local child
  while read -r child; do
    [[ -n "${child}" ]] || continue
    next_generated_root_stop_pid_tree_gracefully "${child}" "${wait_seconds}"
  done < <(pgrep -P "${pid}" 2>/dev/null || true)

  kill -TERM "${pid}" >/dev/null 2>&1 || true
  local _i
  for _i in $(seq 1 "${wait_seconds}"); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  while read -r child; do
    [[ -n "${child}" ]] || continue
    kill -KILL "${child}" >/dev/null 2>&1 || true
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -KILL "${pid}" >/dev/null 2>&1 || true
}

next_generated_root_remove_lane_current_links() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"
  rm -f \
    "${repo_dir}/artifacts/mock-lane/current" \
    "${repo_dir}/artifacts/backend-real/current-run"
}

next_generated_root_stop_lane_web_processes() {
  local repo_dir lane_root pid_file pid cmd
  repo_dir="$(next_generated_root_repo_dir)"

  for lane_root in \
    "${repo_dir}/artifacts/mock-lane/runs" \
    "${repo_dir}/artifacts/backend-real/runs"
  do
    [[ -d "${lane_root}" ]] || continue
    while IFS= read -r pid_file; do
      [[ -n "${pid_file}" ]] || continue
      pid="$(cat "${pid_file}" 2>/dev/null || true)"
      if [[ -z "${pid}" ]]; then
        rm -f "${pid_file}"
        continue
      fi
      if ! kill -0 "${pid}" >/dev/null 2>&1; then
        rm -f "${pid_file}"
        continue
      fi
      cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
      if [[ "${cmd}" == *"next dev"* || "${cmd}" == *"run-next-dev-safe.sh"* || "${cmd}" == *"npm run dev:test"* ]]; then
        next_generated_root_stop_pid_tree_gracefully "${pid}"
      fi
      rm -f "${pid_file}"
    done < <(find "${lane_root}" -mindepth 2 -maxdepth 2 \( -type f -name 'web.pid' -o -type f -name 'next-dev.pid' \) 2>/dev/null | sort -u)
  done
}

next_generated_root_prepare_for_validation() {
  next_generated_root_stop_lane_web_processes
  next_generated_root_remove_lane_current_links
  next_generated_root_normalize
}
