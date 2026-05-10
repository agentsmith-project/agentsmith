import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('run-integration-release-user-story integration dependency contract', () => {
  it('honors caller-provided Agent Task runner images without legacy codex runner aliases', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"');
    expect(script).toContain(
      'RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain(
      'RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain('BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-1}}"');
    expect(script).not.toContain('INTEGRATION_CODEX_RUNNER');
    expect(script).not.toContain(':-notebook');
  });

  it('keeps internal runner storage bootstrap behind AFSCP substrate env names', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"');
    expect(script).not.toContain('kubectl create namespace "${K8S_NAMESPACE}"');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-25432}"');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-29000}"');

    expect(script).toContain('render_k8s_external_dependency_services \\');
    expect(script).toContain('  "${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('  "${INTEGRATION_MINIO_API_PORT}"');

    expect(script).toContain('endpoint: localhost:${INTEGRATION_MINIO_API_PORT}');
    expect(script).toContain('STORAGE_ENDPOINT="localhost:${INTEGRATION_MINIO_API_PORT}"');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \\');
    expect(script).toContain('AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}" \\');
    expect(script).toContain('AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \\');

    expect(script).not.toContain('AGENT_RUNNER_DEVELOPER_JUICEFS');
    expect(script).not.toContain('INTERNAL_AGENT_JUICEFS');
    expect(script).not.toContain('JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT');
    expect(script).not.toContain('STORAGE_ENDPOINT="localhost:19000"');
    expect(script).not.toContain('endpoint: localhost:19000');
  });

  it('passes the sandbox-manager AFSCP env contract directly to the local manager process', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain(
      'AFSCP_INTERNAL_BASE_URL_VALUE="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL:-http://127.0.0.1:28090}}"',
    );
    expect(script).toContain(
      'AFSCP_ORCHESTRATOR_TOKEN_VALUE="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}}"',
    );
    expect(script).toContain('AFSCP_CALLER_SERVICE_VALUE="${AFSCP_CALLER_SERVICE:-${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}}"');
    expect(script).toContain('AFSCP_ACTOR_TYPE_VALUE="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"');
    expect(script).toContain('AFSCP_ACTOR_ID_VALUE="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_CALLER_SERVICE_VALUE}}}"');
    expect(script).toContain('AFSCP_INTERNAL_BASE_URL="${AFSCP_INTERNAL_BASE_URL_VALUE}" \\');
    expect(script).toContain('AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" \\');
    expect(script).toContain('AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE_VALUE}" \\');
    expect(script).toContain('AFSCP_ACTOR_TYPE="${AFSCP_ACTOR_TYPE_VALUE}" \\');
    expect(script).toContain('AFSCP_ACTOR_ID="${AFSCP_ACTOR_ID_VALUE}" \\');
    expect(script).not.toMatch(/^afscp:\s*$/mu);
  });
});
