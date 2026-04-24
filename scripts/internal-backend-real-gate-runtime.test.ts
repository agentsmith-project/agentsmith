import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(relativePath, 'utf8');
}

describe('internal backend-real gate runtime contract', () => {
  it('keeps chat and notebook gates aligned on shared internal sandbox bootstrap', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const chatGate = read('scripts/run-internal-chat-real-gate.sh');
    const notebookGate = read('scripts/run-internal-notebook-real-gate.sh');

    expect(chatGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');
    expect(notebookGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');

    expect(chatGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(notebookGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(chatGate).not.toContain('missing SANDBOX_MANAGER_URL for internal chat backend-real coverage');

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

    expect(chatGate).toContain('SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL_VALUE}" \\');
    expect(chatGate).toContain('SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \\');
    expect(chatGate).toContain('INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \\');
    expect(chatGate).toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \\');
    expect(chatGate).toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE}" \\');
    expect(chatGate).toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \\');
    expect(chatGate).toContain('INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \\');
    expect(chatGate).toContain(
      'INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \\',
    );
    expect(chatGate).toContain('INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE="${RUNNER_IMAGE}" \\');
    expect(chatGate).toContain('INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE="${RUNNER_BASE_IMAGE}" \\');
    expect(chatGate).toContain('INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE=0 \\');
    expect(chatGate).toContain('INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE=0 \\');
  });
});
