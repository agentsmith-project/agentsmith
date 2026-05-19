import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('run-integration-release-user-story integration dependency contract', () => {
  it('preserves caller-selected integration and substrate ports through backend-real env loading', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const loadIndex = script.indexOf('load_backend_real_env "${ROOT_DIR}/.env.backend-real"');

    expect(loadIndex).toBeGreaterThanOrEqual(0);
    for (const key of [
      'INTEGRATION_API_PORT',
      'INTEGRATION_WEB_PORT',
      'INTEGRATION_POSTGRES_PORT',
      'INTEGRATION_MONGO_PORT',
      'INTEGRATION_REDIS_PORT',
      'INTEGRATION_MINIO_API_PORT',
      'INTEGRATION_MINIO_CONSOLE_PORT',
      'INTEGRATION_KEYCLOAK_PORT',
    ]) {
      const original = `ORIGINAL_${key}="\${${key}:-}"`;
      const restore = `export ${key}="\${ORIGINAL_${key}}"`;

      expect(script).toContain(original);
      expect(script).toContain(restore);
      expect(script.indexOf(original)).toBeLessThan(loadIndex);
      expect(script.indexOf(restore)).toBeGreaterThan(loadIndex);
    }
  });

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

    expect(script).not.toContain('endpoint: localhost:${INTEGRATION_MINIO_API_PORT}');
    expect(script).not.toContain('STORAGE_ENDPOINT="localhost:${INTEGRATION_MINIO_API_PORT}"');

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

  it('passes the ASBCP AFSCP env contract directly to the locked ASBCP image', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).toContain('AFSCP_INTERNAL_BASE_URL_VALUE="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL}}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_TOKEN_VALUE="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"');
    expect(script).toContain('AFSCP_CALLER_SERVICE_VALUE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}"');
    expect(script).toContain('AFSCP_ACTOR_TYPE_VALUE="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"');
    expect(script).toContain('AFSCP_ACTOR_ID_VALUE="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_CALLER_SERVICE_VALUE}}}"');
    expect(script).toContain('AFSCP_INTERNAL_BASE_URL="${AFSCP_INTERNAL_BASE_URL_VALUE}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="$(release_user_story_secret_fingerprint "${AFSCP_ORCHESTRATOR_TOKEN_VALUE}")"');
    expect(script).toContain('AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE_VALUE}"');
    expect(script).toContain('AFSCP_ACTOR_TYPE="${AFSCP_ACTOR_TYPE_VALUE}"');
    expect(script).toContain('AFSCP_ACTOR_ID="${AFSCP_ACTOR_ID_VALUE}"');
    expect(script).toContain('INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" bash "${CONTROL_SCRIPT}" start-asbcp');
    expect(script).not.toMatch(/^afscp:\s*$/mu);
    expect(script).not.toContain('http://127.0.0.1:28090');
  });

  it('keeps release user story ASBCP state artifact free of raw service tokens', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const stateBlockStart = script.indexOf('cat > "${ASBCP_STATE_FILE}" <<EOF');
    const stateBlockEnd = script.indexOf('\nEOF', stateBlockStart);
    const stateBlock = script.slice(stateBlockStart, stateBlockEnd);
    const startLine = 'INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" bash "${CONTROL_SCRIPT}" start-asbcp';

    expect(stateBlockStart).toBeGreaterThanOrEqual(0);
    expect(stateBlock).toContain('ASBCP_SERVICE_KEY_FINGERPRINT=');
    expect(stateBlock).toContain('AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT=');
    expect(stateBlock).not.toContain('ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}"');
    expect(stateBlock).not.toContain('AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}"');
    expect(script).toContain(startLine);
  });

  it('starts the wrapper-owned AFSCP local runtime before ASBCP and cleans it up', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const trapIndex = script.indexOf('trap cleanup EXIT');
    const ensureIndex = script.indexOf('\nensure_release_user_story_afscp_local_runtime\n', trapIndex);
    const sandboxStartIndex = script.indexOf('info "starting ASBCP from locked image"', trapIndex);
    const cleanupStart = script.indexOf('cleanup() {');
    const cleanupEnd = script.indexOf('trap cleanup EXIT', cleanupStart);
    const cleanupBody = script.slice(cleanupStart, cleanupEnd);

    expect(script).toContain('resolve_afscp_local_runtime_defaults "${API_PORT}" "vol_release_user_story"');
    expect(script).toContain('ensure_release_user_story_afscp_local_runtime()');
    expect(script).toContain('stop_release_user_story_afscp_local_runtime()');
    expect(script).toContain('RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED=0');
    expect(script).toContain('INTEGRATION_AFSCP_DIR="${INTEGRATION_AFSCP_DIR:-${INTEGRATION_DIR}/afscp}"');
    expect(trapIndex).toBeGreaterThanOrEqual(0);
    expect(ensureIndex).toBeGreaterThan(trapIndex);
    expect(sandboxStartIndex).toBeGreaterThan(ensureIndex);
    expect(cleanupBody).toContain('RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED');
    expect(cleanupBody).toContain('stop_release_user_story_afscp_local_runtime');
  });

  it('passes a single AFSCP and ASBCP runtime truth to the child integration wrapper', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const childStart = script.indexOf('info "running full integration release user story"');
    const childBody = script.slice(childStart);

    expect(childStart).toBeGreaterThanOrEqual(0);
    for (const assignment of [
      'INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \\',
      'AFSCP_BASE_URL="${AFSCP_BASE_URL}" \\',
      'AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \\',
      'AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \\',
      'AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \\',
      'AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \\',
      'AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \\',
      'AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \\',
      'AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \\',
      'AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \\',
      'ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \\',
      'ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \\',
      'AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \\',
    ]) {
      expect(childBody).toContain(assignment);
    }
  });

  it('derives Mongo URL from the release integration port truth instead of inheriting stale parent URLs', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');
    const portDefaultIndex = script.indexOf('INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-27027}"');
    const mongoUrlIndex = script.indexOf('MONGO_URL="mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT}/admin"');
    const runtimeEnvStart = script.indexOf('with_release_user_story_afscp_runtime_env()');
    const runtimeEnvBody = script.slice(runtimeEnvStart, script.indexOf('\nensure_release_user_story_afscp_local_runtime()', runtimeEnvStart));
    const childStart = script.indexOf('info "running full integration release user story"');
    const childBody = script.slice(childStart);

    expect(portDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(mongoUrlIndex).toBeGreaterThan(portDefaultIndex);
    expect(runtimeEnvBody).toContain('export MONGO_URL="${MONGO_URL}"');
    expect(runtimeEnvBody).toContain('export MONGO_DB_NAME="${MONGO_DB_NAME}"');
    expect(childBody).toContain('MONGO_URL="${MONGO_URL}" \\');
    expect(childBody).toContain('MONGO_DB_NAME="${MONGO_DB_NAME}" \\');
  });

  it('keeps JVS details out of the release user story wrapper contract', () => {
    const script = readFileSync('scripts/run-integration-release-user-story.sh', 'utf8');

    expect(script).not.toContain('JVS');
    expect(script).not.toContain('jvs');
  });
});
