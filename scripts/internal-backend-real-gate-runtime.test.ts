import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function renderInternalBackendSandboxConfig(): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-config-'));
  const configPath = path.join(tempRoot, 'asbcp.yaml');

  try {
    return execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          ROOT_DIR="$REPO_ROOT"
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          CONFIG_PATH="$CONFIG_PATH_VALUE"
          ASBCP_PORT="28080"
          K8S_NAMESPACE="agentsmith-sandbox"
          RUNNER_IMAGE="runner:test"
          internal_real_gate_write_sandbox_config
          cat "$CONFIG_PATH"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          CONFIG_PATH_VALUE: configPath,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runPrepareRuntimeWithLegacyRunnerImage(args: {
  legacyRef: string;
  buildRunnerImage: '0' | '1';
}): { stdout: string; stderr: string; status: number | null } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-backend-real-gate-legacy-'));

  try {
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -uo pipefail
          ROOT_DIR="$REPO_ROOT"
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$TEMP_ROOT/calls.log"
          : > "$calls_file"
          record() { printf '%s\\n' "$*" >> "$calls_file"; }
          internal_real_gate_require_host_tools() { record require_host_tools; }
          internal_real_gate_default_kind_cluster_name() { record default_kind_cluster_name; printf 'agentsmith\\n'; }
          internal_real_gate_ensure_kind_cluster() { record ensure_kind_cluster; }
          internal_real_gate_runner_image_reuse_ready() { record reuse_ready; return 1; }
          build_runner_image() { record "build_runner_image $*"; }
          docker() { record "docker $*"; return 1; }
          kubectl() { record "kubectl $*"; return 0; }
          internal_real_gate_publish_local_runner_image_ref() {
            record "publish $*"
            printf 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:%s\\n' "$DIGEST_HEX"
          }
          internal_real_gate_preflight_kind_registry_runner_image() { record "preflight $*"; }
          internal_real_gate_prepare_managed_runner_image_handoff() {
            record child_handoff
            managed_runner_image_handoff_reject_legacy_runner_image_ref "$RUNNER_IMAGE" "[internal-real-gate]" || return 1
          }
          ensure_agentsmith_owned_namespace() { record "namespace $*"; }
          internal_real_gate_ensure_kind_image() { record "kind_image $*"; }
          internal_real_gate_ensure_afscp_storage_csi() { record csi; }
          internal_real_gate_resolve_kind_gateway() { record gateway; printf '172.18.0.1\\n'; }
          k8s_external_minio_fqdn() { record "minio $*"; printf 'minio.internal\\n'; }
          render_k8s_external_dependency_services() { record "render_deps $*"; }
          ensure_internal_afscp_local_runtime() { record afscp; }
          internal_real_gate_write_sandbox_config() { record write_config; }

          GATE_MODE=core-composite
          RUNNER_KIND=agent-task
          RUNNER_BASE_IMAGE=agentsmith-managed-runner-base:local
          RUNNER_IMAGE="$LEGACY_REF"
          BUILD_RUNNER_IMAGE="$BUILD_RUNNER_IMAGE_VALUE"
          DOCKER_BUILD_PROXY_VALUE=""
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          K8S_NAMESPACE=agentsmith-sandbox
          CONFIG_PATH="$TEMP_ROOT/asbcp.yaml"
          ASBCP_PORT=28080
          API_PORT=20072
          INTEGRATION_POSTGRES_PORT=25432
          INTEGRATION_MINIO_API_PORT=29000
          AFSCP_STORAGE_CSI_NAMESPACE=kube-system
          mkdir -p "$INTERNAL_REAL_DIR"

          set +e
          prepare_internal_backend_real_gate_runtime
          status=$?
          set -e
          printf 'status=%s\\n' "$status"
          sed 's/^/call:/' "$calls_file"
          exit 0
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          TEMP_ROOT: tempRoot,
          LEGACY_REF: args.legacyRef,
          BUILD_RUNNER_IMAGE_VALUE: args.buildRunnerImage,
          DIGEST_HEX: 'f'.repeat(64),
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('internal backend-real gate runtime contract', () => {
  it('writes ASBCP sandbox config with the ASBCP main container contract', () => {
    const config = renderInternalBackendSandboxConfig();

    expect(config).toContain('runnerImage: runner:test');
    expect(config).toContain('containerName: main');
    expect(config).not.toContain('containerName: runner');
  });

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
      '\ntrap cleanup EXIT\n\nensure_internal_integration_deps_for_afscp\nwait_for_internal_integration_deps_for_afscp\nensure_internal_default_workspace_for_afscp\nensure_internal_kind_cluster_for_afscp_reset\nreset_internal_afscp_local_runtime\nenable_files_restore_continuation_afscp_restore_recovery\nprepare_internal_backend_real_gate_runtime',
    );
    expect(agentTaskGate).toContain('ensure_internal_kind_cluster_for_afscp_reset()');
    expect(agentTaskGate).toContain('ensure_internal_default_workspace_for_afscp()');
    expect(agentTaskGate).toContain('export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null');
    expect(agentTaskGate).toContain('export AFSCP_DATABASE_URL="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"');
    expect(agentTaskGate).toContain('export AFSCP_ENVIRONMENT=local-real');
    expect(agentTaskGate).toContain('reset_owned_afscp_local_runtime_for_gate');
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
    const kindResetBootstrapFunction = sectionBetween(
      agentTaskGate,
      '\nensure_internal_kind_cluster_for_afscp_reset() {',
      '\n}\n\nreset_internal_afscp_local_runtime()',
    );
    const cleanupFunction = sectionBetween(
      agentTaskGate,
      '\ncleanup() {',
      '\n}\ntrap cleanup EXIT',
    );

    expect(startupBlock).not.toContain('\nstop_internal_afscp_local_runtime\n');
    expect(startupBlock.match(/\nensure_internal_kind_cluster_for_afscp_reset\n/g) ?? []).toHaveLength(1);
    expect(startupBlock.match(/\nreset_internal_afscp_local_runtime\n/g) ?? []).toHaveLength(1);
    expect(startupBlock.indexOf('\nensure_internal_kind_cluster_for_afscp_reset\n')).toBeLessThan(
      startupBlock.indexOf('\nreset_internal_afscp_local_runtime\n'),
    );
    expect(resetFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
    expect(resetFunction).toContain('reset_owned_afscp_local_runtime_for_gate');
    expect(resetFunction.indexOf('stop_internal_afscp_local_runtime')).toBeLessThan(
      resetFunction.indexOf('reset_owned_afscp_local_runtime_for_gate'),
    );
    expect(kindResetBootstrapFunction).toContain('internal_real_gate_require_host_tools');
    expect(kindResetBootstrapFunction).toContain('internal_real_gate_ensure_kind_cluster');
    expect(cleanupFunction).toContain('\n  stop_internal_afscp_local_runtime\n');
  });

  it('lets internal AFSCP ensure use gate-owned deps without shared substrate connection env', () => {
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const ensureFunction = sectionBetween(
      agentTaskGate,
      '\nensure_internal_afscp_local_runtime() {',
      '\n}\n\nstop_internal_afscp_local_runtime()',
    );
    const resetFunction = sectionBetween(
      agentTaskGate,
      '\nreset_internal_afscp_local_runtime() {',
      '\n}\n\nrecord_service()',
    );

    expect(ensureFunction).toContain('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1');
    expect(resetFunction).toContain('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1');
    expect(ensureFunction).toContain('export PATH="${INTERNAL_REAL_DIR}/bin:${PATH}"');
    expect(ensureFunction).toContain('export LD_LIBRARY_PATH="${INTERNAL_REAL_DIR}/bin/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"');
    expect(ensureFunction).toContain('AFSCP_JUICEFS_OUTPUT_PATH="${INTERNAL_REAL_DIR}/bin/juicefs"');
    expect(ensureFunction).toContain('bash "${ROOT_DIR}/scripts/afscp-jvs-image-smoke.sh"');
    expect(ensureFunction.indexOf('export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1')).toBeLessThan(
      ensureFunction.indexOf('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"'),
    );
    expect(ensureFunction.indexOf('AFSCP_JUICEFS_OUTPUT_PATH="${INTERNAL_REAL_DIR}/bin/juicefs"')).toBeLessThan(
      ensureFunction.indexOf('source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"'),
    );
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

  it('fails skills-runtime fast when managed runner image env is explicitly provided', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const skillsWrapper = read('scripts/skills-runtime-backend-real-gate.sh');

    expect(helper).toContain('[[ -n "${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTEGRATION_INTERNAL_AGENT_IMAGE")');
    expect(helper).toContain('[[ -n "${INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTERNAL_AGENT_IMAGE")');
    expect(helper).toContain('[[ -n "${MANAGED_RUNNER_IMAGE:-}" ]] && explicit_image_env+=("MANAGED_RUNNER_IMAGE")');
    expect(helper).toContain('unset them, or use --runner-projection-smoke for release-locked image coverage');
    expect(agentTaskGate).not.toContain('--skills-runtime ignores managed runner image env');
    expect(agentTaskGate).not.toContain('unset INTEGRATION_INTERNAL_AGENT_IMAGE INTERNAL_AGENT_IMAGE MANAGED_RUNNER_IMAGE');
    expect(skillsWrapper).toContain('exit 1');
    expect(skillsWrapper).not.toContain('unset INTEGRATION_INTERNAL_AGENT_IMAGE INTERNAL_AGENT_IMAGE MANAGED_RUNNER_IMAGE');
    expect(skillsWrapper).toContain('unset them, or use --runner-projection-smoke for release-locked image coverage');
  });

  it('prepares a local kind registry digest handoff for non-projection internal gates', () => {
    const repoRoot = process.cwd();
    const runnerDigest = `sha256:${'f'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$(mktemp)"
          trap 'rm -f "$calls_file"' EXIT
          internal_real_gate_publish_local_runner_image_ref() {
            printf 'publish %s\\n' "$1" >> "$calls_file"
            printf 'kind-registry:5000/mbos/agentsmith-managed-runner@%s\\n' "$RUNNER_DIGEST"
          }
          internal_real_gate_preflight_kind_registry_runner_image() {
            printf 'preflight %s\\n' "$1" >> "$calls_file"
          }
          GATE_MODE=core-composite
          RUNNER_IMAGE=agentsmith-managed-runner:local
          internal_real_gate_prepare_managed_runner_image_handoff
          printf 'runner=%s\\n' "$RUNNER_IMAGE"
          cat "$calls_file"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RUNNER_DIGEST: runnerDigest,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const prepareRuntime = sectionBetween(
      helper,
      '\nprepare_internal_backend_real_gate_runtime() {',
      '\n}\n\nprepare_internal_backend_real_spec_runtime()',
    );

    expect(output).toContain(`runner=kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(output).toContain('publish agentsmith-managed-runner:local');
    expect(output).toContain(`preflight kind-registry:5000/mbos/agentsmith-managed-runner@${runnerDigest}`);
    expect(output).not.toContain('agentsmith-agent-task-runner:local');
    expect(prepareRuntime).toContain('internal_real_gate_prepare_managed_runner_image_handoff');
    expect(prepareRuntime.indexOf('internal_real_gate_prepare_managed_runner_image_handoff')).toBeLessThan(
      prepareRuntime.indexOf('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"'),
    );
  });

  it('rejects legacy agent-task-runner digest refs before child specs inherit the image', () => {
    const repoRoot = process.cwd();
    const legacyDigestRef = `agentsmith-agent-task-runner@sha256:${'1'.repeat(64)}`;
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          internal_real_gate_publish_local_runner_image_ref() {
            printf 'publish %s\\n' "$1"
          }
          internal_real_gate_preflight_kind_registry_runner_image() {
            printf 'preflight %s\\n' "$1"
          }
          GATE_MODE=core-composite
          RUNNER_IMAGE="$LEGACY_DIGEST_REF"
          internal_real_gate_prepare_managed_runner_image_handoff
          printf 'child-spec RUNNER_IMAGE=%s\\n' "$RUNNER_IMAGE"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          LEGACY_DIGEST_REF: legacyDigestRef,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('child-spec RUNNER_IMAGE=');
    expect(result.stdout).not.toContain('preflight ');
    expect(result.stdout).not.toContain('publish ');
    expect(result.stderr).toContain('must not reference old agent-task-runner image/path');
    expect(result.stderr).toContain(legacyDigestRef);
  });

  it('rejects legacy runner image refs before prepare runtime can reuse, build, inspect, or hand off', () => {
    const cases = [
      {
        legacyRef: 'agentsmith-agent-task-runner:local',
        buildRunnerImage: '1' as const,
      },
      {
        legacyRef: `kind-registry:5000/mbos/agentsmith-agent-task-runner@sha256:${'1'.repeat(64)}`,
        buildRunnerImage: '0' as const,
      },
    ];

    for (const testCase of cases) {
      const result = runPrepareRuntimeWithLegacyRunnerImage(testCase);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('status=1');
      expect(result.stderr).toContain('must not reference old agent-task-runner image/path');
      expect(result.stderr).toContain(testCase.legacyRef);
      expect(result.stdout).not.toContain('call:reuse_ready');
      expect(result.stdout).not.toContain('call:build_runner_image');
      expect(result.stdout).not.toContain('call:docker image inspect');
      expect(result.stdout).not.toContain('call:publish ');
      expect(result.stdout).not.toContain('call:preflight ');
      expect(result.stdout).not.toContain('call:child_handoff');
    }
  });

  it('prints only the linux/amd64 local kind registry manifest digest ref on publish helper stdout', () => {
    const repoRoot = process.cwd();
    const indexDigest = `sha256:${'a'.repeat(64)}`;
    const amd64ManifestDigest = `sha256:${'b'.repeat(64)}`;
    const attestationDigest = `sha256:${'c'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" ]]; then
              return 0
            fi
            if [[ "$1" == "push" ]]; then
              printf 'latest: digest: %s size: 1234\\n' "$INDEX_DIGEST"
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"%s","platform":{"os":"linux","architecture":"amd64"}},{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"%s","platform":{"os":"unknown","architecture":"unknown"}}]}' "$AMD64_MANIFEST_DIGEST" "$ATTESTATION_DIGEST"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          INDEX_DIGEST: indexDigest,
          AMD64_MANIFEST_DIGEST: amd64ManifestDigest,
          ATTESTATION_DIGEST: attestationDigest,
          RUNTIME_LINE_ID: 'stdout-contract',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${amd64ManifestDigest}\n`);
  });

  it('uses the pushed single image manifest digest instead of a tag-only fallback', () => {
    const repoRoot = process.cwd();
    const rawManifest = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        mediaType: 'application/vnd.oci.image.config.v1+json',
        digest: `sha256:${'d'.repeat(64)}`,
        size: 512,
      },
      layers: [],
    });
    const expectedDigest = `sha256:${createHash('sha256').update(rawManifest).digest('hex')}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" || "$1" == "push" ]]; then
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '%s' "$RAW_MANIFEST"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RAW_MANIFEST: rawManifest,
          RUNTIME_LINE_ID: 'single-manifest-contract',
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toBe(`kind-registry:5000/mbos/agentsmith-managed-runner@${expectedDigest}\n`);
  });

  it('fails fast when the pushed local kind registry ref has no linux/amd64 manifest digest', () => {
    const repoRoot = process.cwd();
    const result = spawnSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          scenario_kind_registry_host() { printf 'localhost\\n'; }
          scenario_kind_registry_host_port() { printf '5001\\n'; }
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          docker() {
            if [[ "$1" == "tag" ]]; then
              return 0
            fi
            if [[ "$1" == "push" ]]; then
              printf 'latest: digest: sha256:%s size: 1234\\n' "\${INDEX_DIGEST_HEX}"
              return 0
            fi
            if [[ "$1" == "buildx" && "$2" == "imagetools" && "$3" == "inspect" && "$4" == "--raw" ]]; then
              printf '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"sha256:%s","platform":{"os":"unknown","architecture":"unknown"}}]}' "\${ATTESTATION_DIGEST_HEX}"
              return 0
            fi
            return 1
          }
          internal_real_gate_publish_local_runner_image_ref agentsmith-managed-runner:test
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          INDEX_DIGEST_HEX: 'a'.repeat(64),
          ATTESTATION_DIGEST_HEX: 'c'.repeat(64),
          RUNTIME_LINE_ID: 'missing-amd64-contract',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('could not resolve linux/amd64 manifest digest for managed runner image after push');
    expect(result.stderr).not.toContain('kind-registry:5000/mbos/agentsmith-managed-runner:');
  });

  it('reconciles kind registry NO_PROXY and CRI-pulls the final skills-runtime digest ref before workload start', () => {
    const repoRoot = process.cwd();
    const runnerDigestRef = `kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'e'.repeat(64)}`;
    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source "$REPO_ROOT/scripts/lib/internal-backend-real-gate.sh"
          calls_file="$(mktemp)"
          trap 'rm -f "$calls_file"' EXIT
          scenario_kind_registry_name() { printf 'kind-registry\\n'; }
          kind_configure_registry_no_proxy_for_containerd() {
            printf 'no-proxy %s %s %s\\n' "$1" "$2" "$3" >> "$calls_file"
          }
          docker() {
            if [[ "$1" == "exec" && "$3" == "crictl" && "$4" == "pull" ]]; then
              printf 'cri-pull %s %s\\n' "$2" "$5" >> "$calls_file"
              return 0
            fi
            return 1
          }
          KIND_NODE_NAME="agentsmith-control-plane"
          internal_real_gate_preflight_kind_registry_runner_image "$RUNNER_DIGEST_REF"
          cat "$calls_file"
        `,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          REPO_ROOT: repoRoot,
          RUNNER_DIGEST_REF: runnerDigestRef,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const prepareRuntime = sectionBetween(
      helper,
      '\nprepare_internal_backend_real_gate_runtime() {',
      '\n}\n\nprepare_internal_backend_real_spec_runtime()',
    );
    const handoffFunction = sectionBetween(
      helper,
      '\ninternal_real_gate_prepare_managed_runner_image_handoff() {',
      '\n}\n\ninternal_real_gate_wait_for_afscp_storage_csi_pods()',
    );

    expect(output).toContain('no-proxy agentsmith-control-plane kind-registry 5000');
    expect(output).toContain(`cri-pull agentsmith-control-plane ${runnerDigestRef}`);
    expect(handoffFunction).toContain('internal_real_gate_preflight_kind_registry_runner_image "${RUNNER_IMAGE}"');
    expect(prepareRuntime).toContain('internal_real_gate_prepare_managed_runner_image_handoff || return 1');
    expect(prepareRuntime.indexOf('internal_real_gate_prepare_managed_runner_image_handoff || return 1')).toBeLessThan(
      prepareRuntime.indexOf('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"'),
    );
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
      + '    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}"\n'
      + '    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"',
    );
    expect(backendRealRun).not.toContain('test:e2e:integration:files:user-stories:restore-continue');
    expect(backendRealRun).not.toContain('e2e/integration-files-user-stories.spec.ts');
  });

  it('keeps runner projection smoke focused and fail-fast on a canonical runner image', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');
    const backendRealRun = read('scripts/backend-real-run.sh');
    const agentTaskRunnerSpec = read('e2e/integration-agent-task-runner.spec.ts');
    const realHelpers = read('e2e/integration-real-helpers.ts');
    const deepseekPrecondition = sectionBetween(
      agentTaskGate,
      '\nensure_runner_projection_smoke_deepseek_preconditions() {',
      '\n}\n\nensure_runner_projection_smoke_image_preconditions',
    );
    const imagePrecondition = sectionBetween(
      agentTaskGate,
      '\nensure_runner_projection_smoke_image_preconditions() {',
      '\n}\n\nensure_runner_projection_smoke_deepseek_preconditions',
    );
    const projectionFunction = shellFunctionBody(agentTaskGate, 'run_runner_projection_smoke_spec');
    const projectionCase = sectionBetween(
      agentTaskRunnerSpec,
      "test('uses request-scoped projected dependencies through agentsmith-runner",
      "test('uses feishu-docs managed credential projection",
    );

    expect(packageJson.scripts?.['test:agent-task:runner:projection-smoke'])
      .toBe('bash scripts/run-internal-agent-task-real-gate.sh --runner-projection-smoke');
    expect(agentTaskGate).toContain('elif [[ "${1:-}" == "--runner-projection-smoke" ]]');
    expect(agentTaskGate).toContain('running focused runner projection smoke with canonical agentsmith-runner image');
    expect(agentTaskGate).toContain('ensure_runner_projection_smoke_image_preconditions');
    expect(agentTaskGate).toContain('ensure_runner_projection_smoke_deepseek_preconditions');
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_PROJECTION_SMOKE=1');
    expect(agentTaskGate).toContain('export INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE=1');
    expect(agentTaskGate).toContain('EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"');
    expect(agentTaskGate).toContain('RUNNER_IMAGE_LOCK_PATH="${RUNNER_IMAGE_LOCK_PATH:-${ROOT_DIR}/scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock}"');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE is required');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must not reference old agent-task-runner image/path');
    expect(agentTaskGate).toContain('INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 is required');
    expect(agentTaskGate).toContain('old monorepo runner image build');
    expect(imagePrecondition).toContain('locked_image="$(runner_image_lock_value image)"');
    expect(imagePrecondition).toContain('locked_digest="$(runner_image_lock_value image_digest)"');
    expect(imagePrecondition).toContain('if [[ "${locked_image}" != *@sha256:* ]]; then');
    expect(imagePrecondition).toContain('if [[ "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" != "${locked_image}" ]]; then');
    expect(imagePrecondition).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE must match locked digest image ref from agentsmith-runner-image.lock');
    expect(imagePrecondition).toContain('tag-only or local non-digest images are not accepted');
    expect(imagePrecondition).toContain('RUNNER_IMAGE="${locked_image}"');
    expect(imagePrecondition).toContain('export INTEGRATION_INTERNAL_AGENT_IMAGE="${locked_image}"');
    expect(imagePrecondition).not.toContain('repo_digests');
    expect(imagePrecondition).not.toContain('lock_pending');
    expect(agentTaskGate).toContain('command -v docker >/dev/null 2>&1');
    expect(agentTaskGate).toContain('docker image inspect "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" >/dev/null 2>&1');
    expect(agentTaskGate).toContain("docker image inspect --format '{{.Id}}' \"${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}\"");
    expect(agentTaskGate).toContain('export INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID="${image_id}"');
    expect(agentTaskGate).toContain('scripts/contracts/check-runner-image-lock.ts');
    expect(agentTaskGate).toContain('BACKEND_REAL_OPENAI_BASE_URL must resolve to DeepSeek');
    expect(agentTaskGate).toContain('deepseek_openai_host()');
    expect(deepseekPrecondition).toContain('deepseek_openai_host "${openai_base_url}"');
    expect(deepseekPrecondition).toContain('"api.deepseek.com"');
    expect(deepseekPrecondition).toContain('*.deepseek.com');
    expect(deepseekPrecondition).not.toContain('*deepseek*');
    expect(deepseekPrecondition).toContain('resolved_host=${openai_host_for_log}');
    expect(deepseekPrecondition).toContain('"passed" "host=${openai_host}"');
    expect(deepseekPrecondition).not.toContain('resolved=${openai_base_url');
    expect(agentTaskGate).toContain('new URL(raw).hostname.toLowerCase()');
    expect(agentTaskGate).toContain('BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL:-${BACKEND_REAL_OPENAI_BASE_URL_VALUE}}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_RUNNER_PROJECTION_SMOKE="${INTEGRATION_RUNNER_PROJECTION_SMOKE:-0}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE="${INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE:-0}" \\');
    expect(agentTaskGate).toContain('docker is required to inspect INTEGRATION_INTERNAL_AGENT_IMAGE');
    expect(agentTaskGate).toContain('local docker image not found');
    expect(projectionFunction).toContain(
      'uses request-scoped projected dependencies through agentsmith-runner in a real Agent Task run resolved by the default Agent Runner',
    );
    expect(projectionCase).toContain('buildJiraProjectionEnvSmokeCommand');
    expect(projectionCase).toContain('readRunnerProjectionSmokeImage');
    expect(projectionCase).toContain('runnerImage: projectionSmokeImage');
    expect(projectionCase).toContain('forceManagedRunnerUpsert: true');
    expect(projectionCase).toContain('runner_projection_smoke_expected_image: projectionSmokeImage');
    expect(projectionCase).toContain('expect(prepared.runnerConfiguredImage).toBe(projectionSmokeImage)');
    expect(projectionCase).toContain('expectManagedAgentRunnerImageEvidenceViaApi');
    expect(projectionCase).toContain('expectManagedWorkloadPodImage');
    expect(agentTaskRunnerSpec).toContain('MBOS_AGENT_PROJECTED_DEPENDENCIES');
    expect(agentTaskRunnerSpec).toContain('jira-auth');
    expect(agentTaskRunnerSpec).toContain('/rest/api/2/myself');
    expect(agentTaskRunnerSpec).toContain('runner_projection_smoke_non_canonical_image');
    expect(realHelpers).toContain('INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE');
    expect(realHelpers).toContain('managed_runner_projection_smoke_image_required');
    expect(realHelpers).toContain('configuredImage: seededDefault.configuredImage');
    expect(realHelpers).toContain('expectManagedAgentRunnerImageEvidenceViaApi');
    expect(realHelpers).toContain('expectManagedWorkloadPodImage');
    expect(projectionCase).not.toContain('jira_ops.py');
    expect(projectionCase).not.toContain('context_cli.py');
    expect(projectionFunction).not.toContain('reads task context through mbos-context');
    expect(backendRealRun).not.toContain('--runner-projection-smoke');
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
      + 'ensure_internal_kind_cluster_for_afscp_reset\n'
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
