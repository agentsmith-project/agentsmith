import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release local precheck AFSCP contract', () => {
  const script = readFileSync('scripts/run-release-local-precheck.sh', 'utf8');
  const internalGate = readFileSync('scripts/run-internal-agent-task-real-gate.sh', 'utf8');
  const fullGate = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');

  it('derives release precheck substrate ports from the backend-real integration truth before building Mongo env', () => {
    expect(script.indexOf('load_backend_real_env "${ROOT_DIR}/.env.backend-real"')).toBeLessThan(
      script.indexOf('MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-17017}}"'),
    );
    expect(script).toContain('KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-18080}}"');
    expect(script).toContain('POSTGRES_PORT="${POSTGRES_PORT:-${INTEGRATION_POSTGRES_PORT:-15432}}"');
    expect(script).toContain('MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-17017}}"');
    expect(script).toContain('REDIS_PORT="${REDIS_PORT:-${INTEGRATION_REDIS_PORT:-16379}}"');
    expect(script).toContain('MINIO_API_PORT="${MINIO_API_PORT:-${INTEGRATION_MINIO_API_PORT:-19000}}"');
    expect(script).toContain('MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}"');
  });

  it('delegates Agent Task coverage to the internal backend-real gate instead of the lightweight Playwright API', () => {
    const helperIndex = script.indexOf('run_agent_task_backend_real_precheck()');
    const preGateStopIndex = script.indexOf('stop_api_web_stack', script.lastIndexOf('PLAYWRIGHT_PID=""'));
    const helperCallIndex = script.indexOf('run_agent_task_backend_real_precheck', helperIndex + 1);

    expect(helperIndex).toBeGreaterThanOrEqual(0);
    expect(preGateStopIndex).toBeGreaterThan(helperIndex);
    expect(helperCallIndex).toBeGreaterThan(preGateStopIndex);
    expect(script).toContain('run_clean bash scripts/run-internal-agent-task-real-gate.sh --skills-runtime');
    expect(script).not.toContain('e2e/integration-agent-task-runner.spec.ts');
    expect(script).not.toContain('file_library_backend_unavailable || true');
  });

  it('passes the AFSCP product, bootstrap, and orchestrator client contract to the owner gate', () => {
    expect(script).toContain('afscp_base_url="${RELEASE_PRECHECK_AFSCP_BASE_URL:-http://127.0.0.1:$((agent_task_api_port + 9030))}"');
    expect(script).toContain('afscp_export_gateway_base_url="${RELEASE_PRECHECK_AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:$((agent_task_api_port + 9031))}"');
    expect(script).toContain('afscp_default_volume_id="${RELEASE_PRECHECK_AFSCP_DEFAULT_VOLUME_ID:-vol_release_precheck_${agent_task_api_port}}"');
    expect(script).toContain('AFSCP_BASE_URL="${afscp_base_url}"');
    expect(script).toContain('AFSCP_EXPORT_GATEWAY_BASE_URL="${afscp_export_gateway_base_url}"');
    expect(script).toContain('AFSCP_DEFAULT_VOLUME_ID="${afscp_default_volume_id}"');
    expect(script).toContain('AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"');
    expect(script).toContain('AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-agentsmith-local-afscp-product-token}"');
    expect(script).toContain('AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"');
    expect(script).toContain('AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-agentsmith-local-afscp-bootstrap-token}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"');
    expect(script).toContain('AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"');
    expect(script).toContain('INTEGRATION_POSTGRES_PORT="${POSTGRES_PORT}"');
    expect(script).toContain('INTEGRATION_MONGO_PORT="${MONGO_PORT}"');
    expect(script).toContain('INTEGRATION_REDIS_PORT="${REDIS_PORT}"');
    expect(script).toContain('INTEGRATION_MINIO_API_PORT="${MINIO_API_PORT}"');
  });

  it('preserves caller-selected substrate ports through backend-real env loading in owner gates', () => {
    for (const source of [internalGate, fullGate]) {
      expect(source).toContain('ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"');
      expect(source).toContain('export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"');
      expect(source.indexOf('ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"')).toBeLessThan(
        source.indexOf('load_backend_real_env'),
      );
      expect(source.indexOf('export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"')).toBeGreaterThan(
        source.indexOf('load_backend_real_env'),
      );
    }
  });

  it('waits for the owner gate substrate ports before nested ensure-default-workspace runs', () => {
    const trapIndex = internalGate.indexOf('trap cleanup EXIT');
    const ensureCallIndex = internalGate.indexOf('\nensure_internal_integration_deps_for_afscp\n', trapIndex);
    const waitCallIndex = internalGate.indexOf('\nwait_for_internal_integration_deps_for_afscp\n', trapIndex);
    const prepareCallIndex = internalGate.indexOf('\nprepare_internal_backend_real_gate_runtime\n', trapIndex);

    expect(internalGate).toContain('wait_for_internal_integration_deps_for_afscp()');
    expect(internalGate).toContain('gate_wait_for_tcp "${INTERNAL_REAL_DIR}" "127.0.0.1" "${INTEGRATION_MONGO_PORT}"');
    expect(ensureCallIndex).toBeGreaterThan(trapIndex);
    expect(waitCallIndex).toBeGreaterThan(ensureCallIndex);
    expect(prepareCallIndex).toBeGreaterThan(waitCallIndex);
  });
});
