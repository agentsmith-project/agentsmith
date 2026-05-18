#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
DEFAULT_GATE_PROFILE="${DEFAULT_GATE_PROFILE:-standalone}"
DEFAULT_GATE_REUSE_FAST_EVIDENCE="${DEFAULT_GATE_REUSE_FAST_EVIDENCE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --campaign-after-gate-fast)
      DEFAULT_GATE_PROFILE="campaign_after_gate_fast"
      shift
      ;;
    *)
      echo "[default-gate] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

info() { echo "[default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

pure_check_now_iso() {
  node -e 'process.stdout.write(new Date().toISOString());'
}

summarize_stream() {
  local summary_file="$1"
  local line_limit="${PURE_CHECK_PRODUCER_SUMMARY_LINES:-80}"
  awk -v target="${summary_file}" -v limit="${line_limit}" '
    {
      print
      if (limit > 0) {
        lines[NR % limit] = $0
      }
    }
    END {
      if (NR == 0 || limit <= 0) {
        exit 0
      }
      start = NR > limit ? NR - limit + 1 : 1
      for (i = start; i <= NR; i += 1) {
        print lines[i % limit] > target
      }
    }
  '
}

is_expected_success_stderr_line() {
  local _check_id="$1"
  local line="$2"
  case "${line}" in
    "Browserslist: caniuse-lite is outdated."*|*"npx update-browserslist-db@latest"*|*"Why you should do it regularly:"*"browserslist/update-db"*)
      return 0
      ;;
  esac
  return 1
}

filter_expected_success_stderr_summary() {
  local check_id="$1"
  local summary_file="$2"
  local filtered_file line
  [[ -s "${summary_file}" ]] || return 0
  filtered_file="${summary_file}.filtered"
  : > "${filtered_file}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if is_expected_success_stderr_line "${check_id}" "${line}"; then
      continue
    fi
    printf '%s\n' "${line}" >> "${filtered_file}"
  done < "${summary_file}"
  mv "${filtered_file}" "${summary_file}"
}

run_pure_check_cmd() {
  local check_id="$1"
  local command="$2"
  shift 2
  local -a required_artifacts=("$@")

  if [[ -z "${AGENTSMITH_VERIFY_REPORT_ROOT:-}" ]]; then
    run_cmd "${command}"
    return $?
  fi

  local tmp_dir stdout_pipe stderr_pipe stdout_summary stderr_summary stdout_pid stderr_pid
  local started_at finished_at status result_status failure_class evidence_status
  tmp_dir="$(mktemp -d)"
  stdout_pipe="${tmp_dir}/stdout.pipe"
  stderr_pipe="${tmp_dir}/stderr.pipe"
  stdout_summary="${tmp_dir}/stdout.summary"
  stderr_summary="${tmp_dir}/stderr.summary"
  mkfifo "${stdout_pipe}" "${stderr_pipe}"
  : > "${stdout_summary}"
  : > "${stderr_summary}"

  summarize_stream "${stdout_summary}" < "${stdout_pipe}" &
  stdout_pid="$!"
  summarize_stream "${stderr_summary}" < "${stderr_pipe}" >&2 &
  stderr_pid="$!"

  info "${command}"
  started_at="$(pure_check_now_iso)"
  if (cd "${ROOT_DIR}" && eval "${command}") > "${stdout_pipe}" 2> "${stderr_pipe}"; then
    status=0
  else
    status=$?
  fi
  finished_at="$(pure_check_now_iso)"

  wait "${stdout_pid}" || true
  wait "${stderr_pid}" || true

  if [[ "${status}" -eq 0 ]]; then
    filter_expected_success_stderr_summary "${check_id}" "${stderr_summary}"
  fi

  if [[ "${status}" -eq 0 ]]; then
    result_status="passed"
    failure_class="none"
  else
    result_status="failed"
    failure_class="product_regression"
  fi

  local -a evidence_args=(
    --repo-root "${AGENTSMITH_VERIFY_REPO_ROOT:-${ROOT_DIR}}"
    --report-root "${AGENTSMITH_VERIFY_REPORT_ROOT}"
    --check-id "${check_id}"
    --status "${result_status}"
    --failure-class "${failure_class}"
    --exit-code "${status}"
    --started-at "${started_at}"
    --finished-at "${finished_at}"
    --stdout-summary-file "${stdout_summary}"
    --stderr-summary-file "${stderr_summary}"
  )
  local required_artifact
  for required_artifact in "${required_artifacts[@]}"; do
    evidence_args+=(--required-artifact "${required_artifact}")
  done

  set +e
  (cd "${ROOT_DIR}" && npx tsx scripts/governance/write-pure-check-producer-evidence.ts "${evidence_args[@]}")
  evidence_status=$?
  set -e
  rm -rf "${tmp_dir}"

  if [[ "${evidence_status}" -ne 0 ]]; then
    echo "[default-gate] warning: pure check producer evidence writer failed for ${check_id} with exit code ${evidence_status}; preserving pure check exit code ${status}" >&2
  fi
  return "${status}"
}

run_default_gate_typegen() {
  run_cmd "npx next typegen ."
}

run_default_gate_typecheck() {
  run_pure_check_cmd "typecheck" "npx tsc --noEmit" \
    "repo_root:.next/types/routes.d.ts:next-typegen-routes" \
    "repo_root:next-env.d.ts:next-env"
}

run_default_gate_build() {
  run_cmd "npm run build"
}

reuse_gate_fast_evidence() {
  [[ "${DEFAULT_GATE_PROFILE}" != "fast" ]] && {
    [[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${DEFAULT_GATE_PROFILE}" == "governance_tooling" ]] || [[ "${DEFAULT_GATE_REUSE_FAST_EVIDENCE}" == "1" ]]
  }
}

skip_workspace_project_focused_visual() {
  [[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}" == "1" ]]
}

skip_governance_focused_visual() {
  [[ "${DEFAULT_GATE_PROFILE}" == "campaign_after_gate_fast" ]] || [[ "${GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}" == "1" ]]
}

case "${DEFAULT_GATE_PROFILE}" in
  standalone|fast|campaign_after_gate_fast|governance_tooling)
    ;;
  *)
    echo "[default-gate] unknown DEFAULT_GATE_PROFILE: ${DEFAULT_GATE_PROFILE}" >&2
    exit 1
    ;;
esac

if reuse_gate_fast_evidence; then
  info "reusing gate:fast evidence; skipping contracts/openapi/lint/typegen/typecheck/build"
else
  next_generated_root_with_source_contract_lock default_gate_shared_preflight \
    next_generated_root_prepare_for_validation
  run_pure_check_cmd "contracts" "npm run contracts:check"
  run_pure_check_cmd "openapi-contract" "npm run contracts:check-openapi"
  run_pure_check_cmd "openapi-generated" "npm run openapi:check-generated"
  run_pure_check_cmd "lint" "npm run lint"
  next_generated_root_run_locked_type_state_gate_sequence \
    default_gate_type_state \
    run_default_gate_typegen \
    run_default_gate_typecheck \
    run_default_gate_build
fi

if [[ "${DEFAULT_GATE_PROFILE}" == "fast" ]]; then
  run_cmd "npm run test:e2e:lane:mock:smoke"
  info "fast engineering gate passed"
  exit 0
fi

if [[ "${DEFAULT_GATE_PROFILE}" == "governance_tooling" ]]; then
  run_cmd "npm run test:governance-tooling"
  info "governance tooling engineering gate passed"
  exit 0
fi

workspace_project_default_gate_command="bash scripts/workspace-project-default-gate.sh --skip-shared-preflight"
if skip_workspace_project_focused_visual; then
  workspace_project_default_gate_command="${workspace_project_default_gate_command} --skip-focused-visual"
fi

governance_default_gate_command="bash scripts/governance-default-gate.sh --skip-shared-preflight"
if skip_governance_focused_visual; then
  governance_default_gate_command="${governance_default_gate_command} --skip-focused-visual"
fi

run_cmd "${workspace_project_default_gate_command}"
run_cmd "${governance_default_gate_command}"

info "default engineering gate passed"
