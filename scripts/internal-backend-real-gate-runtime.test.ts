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
          SANDBOX_ROOT="$TEMP_ROOT/sandbox"
          INTERNAL_REAL_DIR="$TEMP_ROOT/internal"
          CONFIG_PATH="$TEMP_ROOT/sandbox-manager.yaml"
          SANDBOX_PORT="28080"
          SANDBOX_SERVICE_KEY_VALUE="sandbox-service-key"
          K8S_NAMESPACE="agentsmith-sandbox"
          CLEANER_INTERVAL_SECONDS="15"
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
          internal_real_gate_write_sandbox_state_file "$STATE_FILE" "$CONFIG_PATH" "$TEMP_ROOT/sandbox-manager.log" "$TEMP_ROOT/sandbox-cleaner.log"
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

    expect(agentTaskGate).toContain('source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"');

    expect(agentTaskGate).toContain('prepare_internal_backend_real_gate_runtime');
    expect(agentTaskGate).toContain('export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"');
    expect(agentTaskGate).not.toContain('RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host');

    expect(helper).toContain('SANDBOX_MANAGER_URL_VALUE="${SANDBOX_MANAGER_URL:-http://127.0.0.1:${SANDBOX_PORT}}"');
    expect(helper).toContain(
      'AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"',
    );
    expect(helper).toContain('internal_real_gate_ensure_afscp_storage_csi');
    expect(helper).not.toContain('INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
    expect(helper).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE');
    expect(helper).not.toContain('INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE');
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
  });

  it('writes AFSCP manager env values into isolated sandbox state instead of relying on YAML config', () => {
    const helper = read('scripts/lib/internal-backend-real-gate.sh');
    const state = renderSandboxState({
      AFSCP_INTERNAL_BASE_URL: 'http://formal-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_TOKEN: 'formal-orchestrator-token',
      AFSCP_CALLER_SERVICE: 'formal-sandbox-manager',
      AFSCP_ACTOR_TYPE: 'service',
      AFSCP_ACTOR_ID: 'formal-sandbox-actor',
      AFSCP_BASE_URL: 'http://legacy-afscp.internal:28090',
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN: 'legacy-orchestrator-token',
    });

    expect(state).toContain('AFSCP_INTERNAL_BASE_URL="http://formal-afscp.internal:28090"');
    expect(state).toContain('AFSCP_ORCHESTRATOR_TOKEN="formal-orchestrator-token"');
    expect(state).toContain('AFSCP_CALLER_SERVICE="formal-sandbox-manager"');
    expect(state).toContain('AFSCP_ACTOR_TYPE="service"');
    expect(state).toContain('AFSCP_ACTOR_ID="formal-sandbox-actor"');
    expect(helper).not.toMatch(/^afscp:\s*$/mu);
  });

  it('fails direct managed Agent Task run-integration usage before Playwright when sandbox env is missing', () => {
    const integrationGate = read('scripts/run-integration-e2e-full.sh');

    expect(integrationGate).toContain('preflight_managed_agent_task_sandbox_env');
    expect(integrationGate).toContain('managed_agent_task_sandbox_env');
    expect(integrationGate).toContain('Managed Agent Task backend-real coverage requires sandbox bootstrap');
    expect(integrationGate).toContain('agent-task-backend-real-runner|e2e/integration-agent-task-runner.spec.ts');
  });
});
