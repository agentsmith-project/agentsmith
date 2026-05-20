import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

function shellFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(`${functionName}() {`);
  expect(start, `${functionName} start`).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf('\nrun_', start + functionName.length + 4);
  const nextMode = source.indexOf('\nset +e', start);
  const endCandidates = [nextFunction, nextMode].filter((index) => index > start);
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : source.length;

  return source.slice(start, end);
}

function sectionBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `${startNeedle} start`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end, `${endNeedle} end`).toBeGreaterThan(start);

  return source.slice(start, end);
}

function renderSandboxState(env: Record<string, string>): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-'));
  const stateFile = path.join(tempRoot, 'sandbox-control.env');

  try {
    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          ROOT_DIR="$REPO_ROOT"
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          CONFIG_PATH="$TEMP_ROOT/asbcp.yaml"
          ASBCP_PORT="28080"
          ASBCP_INTERNAL_BASE_URL_VALUE="http://127.0.0.1:28080"
          ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
          KIND_CLUSTER_NAME="agentsmith"
          K8S_NAMESPACE="agentsmith-sandbox"
          CSI_DRIVER="csi.juicefs.com"
          STORAGE_CAPACITY="1Pi"
          STORAGE_CLASS_NAME=""
          MOUNT_OPTIONS=""
          SUBDIR=""
          MOUNT_SERVICE_ACCOUNT=""
          MOUNT_IMAGE_OVERRIDE=""
          AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="http://minio.internal:9000"
          MINIO_ACCESS_KEY="minio-ak"
          MINIO_SECRET_KEY="minio-sk"
          MINIO_BUCKET="mbos-dev"
          mkdir -p "$INTERNAL_REAL_DIR"
          internal_real_gate_write_sandbox_state_file "$STATE_FILE" "$CONFIG_PATH" "$TEMP_ROOT/asbcp.log"
          cat "$STATE_FILE"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          ...env,
          REPO_ROOT: repoRoot,
          TEMP_ROOT: tempRoot,
          HOME: path.join(tempRoot, 'home'),
          STATE_FILE: stateFile,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('internal backend-real gate runtime contract', () => {
  it('keeps the Agent Task gate aligned on shared internal sandbox bootstrap', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const reclaimSpec = read('e2e/integration-internal-sandbox-reclaim.spec.ts');
    const developmentGuide = read('DEVELOPMENT.md');
    const secondRunIndex = reclaimSpec.indexOf('const secondRun = await startAgentTaskRunViaApi');
    const secondOutcomeIndex = reclaimSpec.indexOf('runnerOutputActivityId: secondRun.runnerOutputActivityId');
    const asbcpRestartIndex = reclaimSpec.indexOf("await runInternalSandboxControl('stop-asbcp')");

    expect(agentTaskGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');

    expect(agentTaskGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(agentTaskGate).toContain('reset_internal_afscp_local_runtime');
    expect(agentTaskGate).toContain(
      '\ntrap cleanup EXIT\n\nensure_internal_integration_deps_for_afscp\nwait_for_internal_integration_deps_for_afscp\nensure_internal_default_workspace_for_afscp\nreset_internal_afscp_local_runtime\nenable_files_restore_continuation_afscp_restore_recovery\nprepare_internal_backend_real_gate_runtime',
    );
    expect(agentTaskGate).toContain('ensure_internal_default_workspace_for_afscp()');
    expect(agentTaskGate).toContain('export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null');
    expect(agentTaskGate).toContain('export AFSCP_DATABASE_URL="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_ENVIRONMENT=local-real');
    expect(agentTaskGate).toContain('reset_owned_afscp_local_runtime_data');
    expect(agentTaskGate).toContain('export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"');
    expect(agentTaskGate).toContain('export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_MINIO_API_PORT="${ORIGINAL_INTEGRATION_MINIO_API_PORT}"');
    expect(agentTaskGate).toContain('ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"');
    expect(agentTaskGate).toContain('export INTEGRATION_KEYCLOAK_PORT="${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}"');
    expect(agentTaskGate.indexOf('trap cleanup EXIT')).toBeLessThan(
      agentTaskGate.indexOf('prepare_internal_backend_real_gate_runtime'),
    );
    expect(agentTaskGate).toContain('export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"');
    expect(agentTaskGate).not.toContain('RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host');

    expect(helper).toContain('ASBCP_INTERNAL_BASE_URL_VALUE="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"');
    expect(helper).toContain(
      'AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"',
    );
    expect(helper).toContain('internal_real_gate_ensure_afscp_storage_csi');
    expect(helper).toContain('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    expect(helper).not.toContain('kubectl create namespace "${K8S_NAMESPACE}"');
    expect(helper).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
    expect(helper).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE');
    expect(helper).not.toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
    expect(helper).toContain('render_k8s_external_dependency_services \\');
    expect(helper).toContain('internal_real_gate_start_runtime "${spec_state_file}"');
    expect(helper).not.toContain('start-cleaner');
    expect(helper).not.toContain('stop-cleaner');
    expect(helper).not.toContain('with-cleaner');
    expect(helper).not.toContain('sandbox-cleaner');
    expect(helper).toContain('rebuild_runner_base_image="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}"');
    expect(helper).toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "${rebuild_runner_base_image}" "1"',
    );
    expect(helper).not.toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "0" "1"',
    );

    expect(agentTaskGate).toContain('ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\');
    expect(agentTaskGate).not.toContain('start-cleaner');
    expect(agentTaskGate).not.toContain('stop-cleaner');
    expect(agentTaskGate).not.toContain('with-cleaner');
    expect(agentTaskGate).not.toContain('cleaner_log');
    expect(agentTaskGate).not.toContain('sandbox-cleaner');
    expect(agentTaskGate).toContain('ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(agentTaskGate).toContain('AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}" \\');
    expect(agentTaskGate).toContain('AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \\');
    expect(agentTaskGate).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE=');
    expect(agentTaskGate).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT=');
    expect(agentTaskGate).not.toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE=');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \\');
    expect(agentTaskGate).toContain(
      'INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \\',
    );
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \\');

    expect(reclaimSpec).toContain('deleteInternalWorkloadViaAsbcp');
    expect(secondRunIndex).toBeGreaterThanOrEqual(0);
    expect(secondOutcomeIndex).toBeGreaterThan(secondRunIndex);
    expect(asbcpRestartIndex).toBeGreaterThan(secondOutcomeIndex);
    expect(reclaimSpec).not.toContain('start-cleaner');
    expect(reclaimSpec).not.toContain('stop-cleaner');
    expect(reclaimSpec).not.toContain('run-cleaner-once');
    expect(developmentGuide).not.toContain('sandbox-cleaner');
  });

  it('starts the internal Agent Task gate without duplicating AFSCP stop before reset', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const startupBlock = sectionBetween(
      agentTaskGate,
      '\ntrap cleanup EXIT\n',
      '\ngate_record_preflight_check "${INTERNAL_REAL_DIR}" "kind_cluster"',
    );
    const resetFunction = sectionBetween(
      agentTaskGate,
      '\nreset_internal_afscp_local_runtime() {',
      '\n}\n\nrecord_service()',
    );
    const cleanupFunction = sectionBetween(
      agentTaskGate,
      '\ncleanup() {',
      '\n}\ntrap cleanup EXIT',
    );

    expect(startupBlock).not.toContain('\nstop_internal_afscp_local_runtime\n');
    expect(startupBlock.match(/\nreset_internal_afscp_local_runtime\n/g) ?? []).toHaveLength(1);
    expect(resetFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
    expect(resetFunction).toContain('reset_owned_afscp_local_runtime_data');
    expect(resetFunction.indexOf('stop_internal_afscp_local_runtime')).toBeLessThan(
      resetFunction.indexOf('reset_owned_afscp_local_runtime_data'),
    );
    expect(cleanupFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
  });

  it('allocates isolated ports for nested Context Store specs without cleaning unowned dev servers', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(agentTaskGate).toContain('resolve_internal_spec_port_pair()');
    expect(agentTaskGate).toContain('prepare_internal_spec_port_pair()');
    expect(agentTaskGate).toContain('backend_real_gate_cleanup_listener "${web_port}" web || return 1');
    expect(agentTaskGate).toContain('INTERNAL_REAL_SPEC_WEB_PORT_BASE:-33000');
    expect(agentTaskGate).toContain('preferred ports api=${preferred_api_port} web=${preferred_web_port} unavailable');
    expect(agentTaskGate).toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members|task context stays private to the task owner within the same workspace" 23079 33079',
    );
    expect(agentTaskGate).not.toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members" 20079 3101',
    );
    expect(agentTaskGate).not.toContain(
      'run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "task context stays private to the task owner within the same workspace" 20080 3041',
    );
  });

  it('writes only non-sensitive AFSCP ASBCP identity into isolated sandbox state instead of raw tokens', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const state = renderSandboxState({
      AFSCP_INTERNAL_BASE_URL: 'http://formal-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_TOKEN: 'formal-orchestrator-token',
      AFSCP_CALLER_SERVICE: 'formal-asbcp',
      AFSCP_ACTOR_TYPE: 'service',
      AFSCP_ACTOR_ID: 'formal-sandbox-actor',
      AFSCP_BASE_URL: 'http://legacy-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN: 'legacy-orchestrator-token',
    });

    expect(state).toContain('AFSCP_INTERNAL_BASE_URL="http://formal-afscp.internal:28090"');
    expect(state).toContain('AFSCP_CALLER_SERVICE="formal-asbcp"');
    expect(state).toContain('AFSCP_ACTOR_TYPE="service"');
    expect(state).toContain('AFSCP_ACTOR_ID="formal-sandbox-actor"');
    expect(state).toMatch(/KUBECONFIG=".*\/home\/agentsmith\/local-kind\/kind-agentsmith\.kubeconfig"/u);
    expect(state).toContain('ASBCP_SERVICE_KEY_FINGERPRINT="sha256:');
    expect(state).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="sha256:');
    expect(state).not.toContain('ASBCP_SERVICE_KEY_VALUE=');
    expect(state).not.toContain('sandbox-service-key');
    expect(state).not.toContain('AFSCP_ORCHESTRATOR_TOKEN="formal-orchestrator-token"');
    expect(state).not.toContain('AFSCP_ORCHESTRATOR_SERVICE_TOKEN="formal-orchestrator-token"');
    expect(state).not.toContain('legacy-orchestrator-token');
    expect(state).not.toContain('CLEANER_');
    expect(state).not.toContain('sandbox-cleaner');
    expect(helper).not.toMatch(/^afscp:\s*$/mu);
  });

  it('fails direct managed Agent Task run-integration usage before Playwright when ASBCP env is missing', () => {
    const integrationGate = read('scripts/run-integration-e2e-full.sh');

    expect(integrationGate).toContain('preflight_managed_agent_task_asbcp_env');
    expect(integrationGate).toContain('managed_agent_task_asbcp_env');
    expect(integrationGate).toContain('Managed Agent Task backend-real coverage requires ASBCP bootstrap');
    expect(integrationGate).toContain('agent-task-backend-real-runner|e2e/integration-agent-task-runner.spec.ts|e2e/integration-visual-review.spec.ts');
    expect(integrationGate).toContain("grep -q 'startAgentTaskRunViaApi'");
  });

  it('runs backend-real core internal coverage through one composite managed Agent Task producer with batched greps', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');
    const skillsFunction = shellFunctionBody(agentTaskGate, 'run_skills_runtime_specs');
    const compositeFunction = shellFunctionBody(agentTaskGate, 'run_core_composite_specs');

    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--core-composite" ]]');
    expect(agentTaskGate).toContain('running internal agent-task core composite real integration');
    expect(backendRealRun).toContain('bash scripts/run-internal-agent-task-real-gate.sh --core-composite');

    expect(skillsFunction.match(/run_internal_spec_grep e2e\/integration-agent-task-runner\.spec\.ts/g) ?? []).toHaveLength(1);
    expect(skillsFunction.match(/run_internal_spec_grep e2e\/integration-context-store-isolation\.spec\.ts/g) ?? []).toHaveLength(1);
    expect(skillsFunction).toContain(
      'reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner'
      + '|writes task context through mbos-context and persists it for the task owner'
      + '|uses jira-ops task context before member context in a real Agent Task run resolved by the default Agent Runner'
      + '|uses feishu-docs managed credential projection in a real Agent Task run resolved by the default Agent Runner'
      + '|reads task context through mbos-context inside a real Agent Task terminal session resolved by the default Agent Runner'
      + '|rejects shared workspace context writes inside a real Agent Task terminal session resolved by the default Agent Runner',
    );
    expect(skillsFunction).toContain(
      'member context stays private between workspace members'
      + '|task context stays private to the task owner within the same workspace',
    );
    expect(skillsFunction.match(/reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner/g) ?? [])
      .toHaveLength(1);

    expect(compositeFunction).toContain('run_skills_runtime_specs "${API_PORT}" "${WEB_PORT}"');
    expect(compositeFunction).toContain('run_internal_reclaim_spec "$((API_PORT + 1))" "$((WEB_PORT + 1))"');
    expect(compositeFunction).not.toContain('run_internal_workspace_specs');
  });

  it('passes child integration specs through the parent-prepared deps/init/default-workspace boundary', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const integrationCallIndex = agentTaskGate.indexOf('bash scripts/run-integration-e2e-full.sh "${spec}" "$@"');

    expect(integrationCallIndex).toBeGreaterThanOrEqual(0);
    expect(agentTaskGate).toContain('local spec_kubeconfig');
    expect(agentTaskGate).toContain('spec_kubeconfig="$(internal_real_gate_asbcp_kubeconfig_path)"');
    expect(agentTaskGate).toContain('KUBECONFIG="${spec_kubeconfig}" \\');
    expect(agentTaskGate.indexOf('KUBECONFIG="${spec_kubeconfig}" \\')).toBeLessThan(integrationCallIndex);
    for (const assignment of [
      'INTEGRATION_BOOTSTRAP_DEPS=false \\',
      'INTEGRATION_INIT_DEPS=false \\',
      'INTEGRATION_ENSURE_DEFAULT_WORKSPACE=false \\',
    ]) {
      expect(agentTaskGate).toContain(assignment);
      expect(agentTaskGate.indexOf(assignment)).toBeLessThan(integrationCallIndex);
    }
    expect(agentTaskGate).toContain('ensure_internal_default_workspace_for_afscp');
  });

  it('routes backend-real visual review through the shared internal sandbox bootstrap', () => {
    const visualWrapper = read('scripts/backend-real-visual-review.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(visualWrapper).toContain('bash scripts/run-internal-agent-task-real-gate.sh --visual-review');
    expect(visualWrapper).toContain('INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${ARTIFACT_DIR}"');
    expect(visualWrapper).toContain('export NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE:-validation}"');
    expect(visualWrapper).toContain('NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE}"');
    expect(visualWrapper).not.toContain('bash scripts/run-integration-e2e-full.sh e2e/integration-visual-review.spec.ts');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--visual-review" ]]');
    expect(agentTaskGate).toContain('running backend-real visual review with internal managed Agent Task sandbox');
    expect(agentTaskGate).toContain('run_internal_spec e2e/integration-visual-review.spec.ts "${API_PORT}" "${WEB_PORT}" "${VISUAL_REVIEW_STATE_FILE}"');
    expect(agentTaskGate).toContain('RELEASE_REAL_VISUAL_ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${INTERNAL_VISUAL_ARTIFACT_DIR}}"');
    expect(agentTaskGate).toContain('UX_TRACE_OUTPUT_ROOT="${UX_TRACE_OUTPUT_ROOT:-${INTERNAL_VISUAL_ARTIFACT_DIR}/ux-traces}"');
    expect(agentTaskGate).toContain('INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\');
    expect(agentTaskGate.indexOf('INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\')).toBeLessThan(
      agentTaskGate.indexOf('bash scripts/run-integration-e2e-full.sh "${spec}" "$@"'),
    );
  });

  it('routes Files restore continuation through the internal managed Agent Task sandbox harness', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const wrapper = read('scripts/files-restore-continuation-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');

    expect(packageJson.scripts?.['test:e2e:integration:files:user-stories:restore-continue'])
      .toBe('bash scripts/files-restore-continuation-real-gate.sh');
    expect(wrapper).toContain('RESTORE_CONTINUATION_SPEC="e2e/integration-files-user-stories.spec.ts"');
    expect(wrapper).toContain('RESTORE_CONTINUATION_GREP="same task can continue after Files restore"');
    expect(wrapper).toContain('bash scripts/run-internal-agent-task-real-gate.sh --files-restore-continue -- "$@"');
    expect(wrapper).toContain('npx playwright test --list --config playwright.config.integration.ts');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--files-restore-continue" ]]');
    expect(agentTaskGate).toContain('running Files restore continuation with internal managed Agent Task sandbox');
    expect(agentTaskGate).toContain(
      'run_internal_spec_grep e2e/integration-files-user-stories.spec.ts "same task can continue after Files restore" 21020 3121 "${PLAYWRIGHT_PASSTHROUGH_ARGS[@]}"',
    );
    expect(agentTaskGate).toContain('ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\');
    expect(agentTaskGate).toContain('ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\');
    expect(agentTaskGate).toContain('AGENT_EXECUTION_WS_BASE_URL="${spec_agent_execution_ws_base_url}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(agentTaskGate).toContain('export ENV_FILE=/dev/null');
    expect(agentTaskGate).toContain(
      'export ENV_FILE=/dev/null\n'
      + '    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"',
    );
    expect(backendRealRun).not.toContain('test:e2e:integration:files:user-stories:restore-continue');
    expect(backendRealRun).not.toContain('e2e/integration-files-user-stories.spec.ts');
  });

  it('enables AFSCP direct restore recovery only for the focused Files restore continuation gate', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(agentTaskGate).toContain('enable_files_restore_continuation_afscp_restore_recovery()');
    expect(agentTaskGate).toContain(
      'if [[ "${GATE_MODE}" == "files-restore-continue" ]]; then\n'
      + '    export AFSCP_RESTORE_RECOVERY_ENABLED="${AFSCP_RESTORE_RECOVERY_ENABLED:-true}"\n'
      + '  fi',
    );
    expect(agentTaskGate).toContain(
      '\nwait_for_internal_integration_deps_for_afscp\n'
      + 'ensure_internal_default_workspace_for_afscp\n'
      + 'reset_internal_afscp_local_runtime\n'
      + 'enable_files_restore_continuation_afscp_restore_recovery\n'
      + 'prepare_internal_backend_real_gate_runtime',
    );
    expect(agentTaskGate).not.toContain('AFSCP_JVS_DIRECT_RESTORE_BINARY_SHA256="');
    expect(agentTaskGate).not.toContain('AFSCP_JVS_DIRECT_RESTORE_SOURCE_REF="');
  });

  it('keeps Files restore continuation evidence based on runner-observed task metadata', () => {
    const spec = read('e2e/integration-files-user-stories.spec.ts');
    const story = read('e2e/stories/backend-real/agent-task-image-asset-savepoint-delete-restore.story.md');

    expect(spec).toContain('runtime_task_id = os.environ.get("MBOS_AGENT_TASK_ID", "").strip()');
    expect(spec).toContain('f"runtime_observed_task_id={runtime_task_id}"');
    expect(spec).toContain('expect(postRestoreFields.runtime_observed_task_id).toBe(taskId)');
    expect(spec).toContain('f"api_bound_task_id={api_task_id}"');
    expect(spec).toContain('f"api_bound_workspace_file_library_id={api_bound_library_id}"');
    expect(spec).not.toContain('expected_task_id =');
    expect(spec).not.toContain('expected_library_id =');
    expect(spec).not.toContain('expected_evidence =');
    expect(story).toContain('runner-observed task metadata');
  });
});
