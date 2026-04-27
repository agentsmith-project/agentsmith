import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('run-integration-release-user-story integration dependency contract', () => {
  it('honors caller-provided codex runner images as internal runner aliases instead of forcing a hidden rebuild', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain(
      'RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-${INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain(
      'RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-${INTEGRATION_CODEX_RUNNER_BASE_DOCKER_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}}"',
    );
    expect(script).toContain('BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-${INTEGRATION_CODEX_RUNNER_REBUILD_IMAGE:-1}}"');
  });

  it('uses integration dependency ports as the single source of truth for internal runner mounts and child lane env', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-25432}"');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-29000}"');

    expect(script).toContain(
      'EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-${INTEGRATION_POSTGRES_PORT}}"',
    );
    expect(script).toContain(
      'EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:${INTEGRATION_MINIO_API_PORT}}"',
    );

    expect(script).toContain('render_k8s_external_dependency_services \\');
    expect(script).toContain('  "${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('  "${INTEGRATION_MINIO_API_PORT}"');

    expect(script).toContain('endpoint: localhost:${INTEGRATION_MINIO_API_PORT}');
    expect(script).toContain('STORAGE_ENDPOINT="localhost:${INTEGRATION_MINIO_API_PORT}"');

    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \\');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \\');

    expect(script).not.toContain('EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-15432}"');
    expect(script).not.toContain('EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:19000}"');
    expect(script).not.toContain('STORAGE_ENDPOINT="localhost:19000"');
    expect(script).not.toContain('endpoint: localhost:19000');
  });
});
