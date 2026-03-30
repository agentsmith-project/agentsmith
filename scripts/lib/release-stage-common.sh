#!/usr/bin/env bash
set -euo pipefail

prune_directory_keep_latest() {
  local dir="$1"
  local keep_count="$2"
  local protect_path="${3:-}"
  [[ -d "${dir}" ]] || return 0

  mapfile -t entries < <(find "${dir}" -mindepth 1 -maxdepth 1 -printf '%T@ %p\n' | sort -nr | awk '{ $1=""; sub(/^ /, ""); print }')
  local index=0
  local entry real_entry
  for entry in "${entries[@]}"; do
    [[ -n "${entry}" ]] || continue
    real_entry="$(readlink -f "${entry}" 2>/dev/null || printf '%s' "${entry}")"
    if [[ -n "${protect_path}" && "${real_entry}" == "${protect_path}" ]]; then
      continue
    fi
    index=$((index + 1))
    if (( index <= keep_count )); then
      continue
    fi
    rm -rf "${entry}"
    log "pruned $(basename "${entry}")"
  done
}

write_release_report() {
  local title="$1"
  local report_json="$2"
  local report_md="$3"
  local extra_lines="${4:-}"

  ensure_state
  cp "$(state_file)" "${report_json}"
  cat > "${report_md}" <<EOF
# ${title}

- release: ${RELEASE_ID}
- current: ${CURRENT_LINK}
- compose: ${RELEASE_ROOT}/compose/docker-compose.yml
${extra_lines}- state: $(state_file)
- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

\`\`\`json
$(cat "$(state_file)")
\`\`\`
EOF
  log "report ok: ${report_md}"
}

require_release_path() {
  local path="$1"
  local description="$2"
  local kind="${3:-file}"

  case "${kind}" in
    file)
      [[ -f "${path}" ]] || die "missing ${description} in ${RELEASE_ROOT}"
      ;;
    dir)
      [[ -d "${path}" ]] || die "missing ${description} in ${RELEASE_ROOT}"
      ;;
    exe)
      [[ -x "${path}" ]] || die "missing ${description} at ${path}"
      ;;
    *)
      die "unsupported require_release_path kind: ${kind}"
      ;;
  esac
}
