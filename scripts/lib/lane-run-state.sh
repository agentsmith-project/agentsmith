#!/usr/bin/env bash

lane_state_root() {
  local lane_name="$1"
  printf '%s/artifacts/%s\n' "${ROOT_DIR}" "${lane_name}"
}

lane_runs_root() {
  local lane_name="$1"
  printf '%s/runs\n' "$(lane_state_root "${lane_name}")"
}

lane_generate_run_id() {
  local prefix="${1:-run}"
  printf '%s-%s-%s-%s\n' "${prefix}" "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "${RANDOM}"
}

lane_run_root() {
  local lane_name="$1"
  local run_id="$2"
  printf '%s/%s\n' "$(lane_runs_root "${lane_name}")" "${run_id}"
}

lane_prepare_run_root() {
  local lane_name="$1"
  local run_id="$2"
  local current_name="${3:-current}"
  local root runs run_root current_path legacy_path
  root="$(lane_state_root "${lane_name}")"
  runs="$(lane_runs_root "${lane_name}")"
  run_root="$(lane_run_root "${lane_name}" "${run_id}")"
  mkdir -p "${runs}" "${run_root}"
  current_path="${root}/${current_name}"
  if [[ -e "${current_path}" && ! -L "${current_path}" ]]; then
    legacy_path="${root}/${current_name}-legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "${current_path}" "${legacy_path}"
  fi
  ln -sfn "${run_root}" "${current_path}"
  printf '%s\n' "${run_root}"
}

lane_prepare_alias_link() {
  local target="$1"
  local alias_path="$2"
  local legacy_path
  mkdir -p "$(dirname "${alias_path}")"
  if [[ -e "${alias_path}" && ! -L "${alias_path}" ]]; then
    legacy_path="${alias_path}-legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "${alias_path}" "${legacy_path}"
  fi
  ln -sfn "${target}" "${alias_path}"
}

lane_status_file() {
  local run_root="$1"
  printf '%s/.status\n' "${run_root}"
}

lane_mark_status() {
  local run_root="$1"
  local status="$2"
  printf '%s\n' "${status}" > "$(lane_status_file "${run_root}")"
}

lane_read_status() {
  local run_root="$1"
  cat "$(lane_status_file "${run_root}")" 2>/dev/null || printf 'incomplete'
}

lane_remove_current_link_if_matches() {
  local lane_name="$1"
  local run_root="$2"
  local current_name="${3:-current}"
  local current_link
  current_link="$(lane_state_root "${lane_name}")/${current_name}"
  if [[ -L "${current_link}" ]] && [[ "$(realpath -m "${current_link}")" == "$(realpath -m "${run_root}")" ]]; then
    rm -f "${current_link}"
  fi
}

lane_prune_legacy_aliases() {
  local lane_name="$1"
  local keep_count="${2:-1}"
  local stale_hours="${3:-24}"
  local root stale_cutoff now
  root="$(lane_state_root "${lane_name}")"
  mkdir -p "${root}"

  if ! [[ "${keep_count}" =~ ^[0-9]+$ ]] || [[ "${keep_count}" -lt 0 ]]; then
    keep_count=1
  fi
  if ! [[ "${stale_hours}" =~ ^[0-9]+$ ]] || [[ "${stale_hours}" -lt 0 ]]; then
    stale_hours=24
  fi

  now="$(date +%s)"
  stale_cutoff="$((now - (stale_hours * 3600)))"

  local legacy_dirs=()
  while IFS= read -r dir; do
    [[ -n "${dir}" ]] || continue
    legacy_dirs+=("${dir}")
  done < <(find "${root}" -mindepth 1 -maxdepth 1 -type d -name '*-legacy-*' | xargs -r ls -1dt 2>/dev/null || true)

  local index=0
  local dir modified_at
  for dir in "${legacy_dirs[@]}"; do
    index=$((index + 1))
    modified_at="$(stat -c '%Y' "${dir}" 2>/dev/null || printf '0')"
    if [[ "${index}" -gt "${keep_count}" || "${modified_at}" -lt "${stale_cutoff}" ]]; then
      rm -rf "${dir}"
    fi
  done
}

lane_prune_runs() {
  local lane_name="$1"
  local keep_count="${2:-5}"
  local stale_hours="${3:-24}"
  local runs_root
  runs_root="$(lane_runs_root "${lane_name}")"
  mkdir -p "${runs_root}"
  if ! [[ "${keep_count}" =~ ^[0-9]+$ ]] || [[ "${keep_count}" -lt 0 ]]; then
    keep_count=5
  fi
  if ! [[ "${stale_hours}" =~ ^[0-9]+$ ]] || [[ "${stale_hours}" -lt 0 ]]; then
    stale_hours=24
  fi

  local stale_cutoff now
  now="$(date +%s)"
  stale_cutoff="$((now - (stale_hours * 3600)))"

  local dir
  while IFS= read -r dir; do
    [[ -n "${dir}" ]] || continue
    case "$(lane_read_status "${dir}")" in
      success)
        rm -rf "${dir}"
        ;;
      incomplete)
        if [[ "$(stat -c '%Y' "${dir}" 2>/dev/null || printf '0')" -lt "${stale_cutoff}" ]]; then
          rm -rf "${dir}"
        fi
        ;;
    esac
  done < <(find "${runs_root}" -mindepth 1 -maxdepth 1 -type d | sort)

  if [[ "${keep_count}" -eq 0 ]]; then
    find "${runs_root}" -mindepth 1 -maxdepth 1 -type d \
      -exec sh -c '[ "$(cat "$1/.status" 2>/dev/null || printf incomplete)" = "failed" ] && rm -rf "$1"' sh {} \;
    return 0
  fi

  local failed_dirs=()
  while IFS= read -r dir; do
    [[ -n "${dir}" ]] || continue
    failed_dirs+=("${dir}")
  done < <(
    find "${runs_root}" -mindepth 1 -maxdepth 1 -type d \
      -exec sh -c '[ "$(cat "$1/.status" 2>/dev/null || printf incomplete)" = "failed" ] && printf "%s\n" "$1"' sh {} \; \
      | xargs -r ls -1dt 2>/dev/null || true
  )

  local index=0
  for dir in "${failed_dirs[@]}"; do
    index=$((index + 1))
    if [[ "${index}" -gt "${keep_count}" ]]; then
      rm -rf "${dir}"
    fi
  done

  lane_prune_legacy_aliases "${lane_name}" 1 "${stale_hours}"
}
