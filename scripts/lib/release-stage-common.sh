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
  local evidence_dir="${REPORT_DIR}/verify-artifacts/evidence"

  ensure_state
  python3 - <<'PY' "$(state_file)" "${evidence_dir}" "${report_json}" "${title}" "${RELEASE_ID}"
import json
import pathlib
import sys

state_path = pathlib.Path(sys.argv[1])
evidence_dir = pathlib.Path(sys.argv[2])
report_path = pathlib.Path(sys.argv[3])
title = sys.argv[4]
release_id = sys.argv[5]

state = json.loads(state_path.read_text(encoding='utf-8'))

def load_json(name: str):
    path = evidence_dir / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return None

evidence = {
    "dir": str(evidence_dir),
    "runtime": load_json("runtime.json"),
    "result": load_json("result.json"),
    "resolved_env": load_json("resolved-env.json"),
    "preflight": load_json("preflight.json"),
    "failure_classification": load_json("failure-classification.json"),
    "workspace_access": load_json("workspace-access.json"),
    "service_status": load_json("service-status.json"),
    "task_summary": load_json("task-summary.json"),
    "mount_tree_path": str(evidence_dir / "mount-tree.txt") if (evidence_dir / "mount-tree.txt").exists() else None,
}

report = dict(state)
report["report"] = {
    "title": title,
    "release_id": release_id,
    "state_path": str(state_path),
    "evidence": evidence,
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
PY
  cat > "${report_md}" <<EOF
# ${title}

- release: ${RELEASE_ID}
- current: ${CURRENT_LINK}
- compose: ${RELEASE_ROOT}/compose/docker-compose.yml
${extra_lines}- state: $(state_file)
- evidence: ${evidence_dir}
- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

\`\`\`json
$(cat "${report_json}")
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
