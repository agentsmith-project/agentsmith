import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

describe('internal backend-real gate runtime contract', () => {
  it('keeps the Agent Task gate aligned on shared internal sandbox bootstrap', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const agentTaskGate = read('scripts/run-internal-agent-task-real-gate.sh');

    expect(agentTaskGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');

    expect(agentTaskGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(agentTaskGate).toContain('export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"');
    expect(agentTaskGate).not.toContain('RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host');

    expect(helper).toContain('SANDBOX_MANAGER_URL_VALUE="${SANDBOX_MANAGER_URL:-http://127.0.0.1:${SANDBOX_PORT}}"');
    expect(helper).toContain(
      'INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-$(k8s_external_postgres_fqdn "${K8S_NAMESPACE}")}"',
    );
    expect(helper).toContain(
      'JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"',
    );
    expect(helper).toContain(
      'INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE:-127.0.0.1}"',
    );
    expect(helper).toContain(
      'INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE:-${INTEGRATION_POSTGRES_PORT}}"',
    );
    expect(helper).toContain(
      'INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:${INTEGRATION_MINIO_API_PORT}}"',
    );
    expect(helper).toContain('render_k8s_external_dependency_services \\');
    expect(helper).toContain('INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" start-manager 1>&2');
    expect(helper).toContain('rebuild_runner_base_image="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}"');
    expect(helper).toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "${rebuild_runner_base_image}" "1"',
    );
    expect(helper).not.toContain(
      'build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "0" "1"',
    );

    expect(agentTaskGate).toContain('SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL_VALUE}" \\');
    expect(agentTaskGate).toContain('SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(agentTaskGate).toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \\');
    expect(agentTaskGate).toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \\');
    expect(agentTaskGate).toContain(
      'INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \\',
    );
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \\');
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \\');
    expect(agentTaskGate).toContain(
      'INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \\',
    );
    expect(agentTaskGate).toContain('INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \\');
  });

  it('fails direct managed Agent Task run-integration usage before Playwright when sandbox env is missing', () => {
    const integrationGate = read('scripts/run-integration-e2e-full.sh');

    expect(integrationGate).toContain('preflight_managed_agent_task_sandbox_env');
    expect(integrationGate).toContain('managed_agent_task_sandbox_env');
    expect(integrationGate).toContain('Managed Agent Task backend-real coverage requires sandbox bootstrap');
    expect(integrationGate).toContain('agent-task-backend-real-runner|e2e/integration-agent-task-runner.spec.ts');
  });
});
