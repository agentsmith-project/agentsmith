import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release local precheck lightweight contract', () => {
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

  it('keeps only lightweight early-fail dependency, API, Web, and auth checks', () => {
    expect(script).toContain('deps_ready()');
    expect(script).toContain('run_clean make deps-bootstrap');
    expect(script).toContain('npm run integration:deps:init:postgres');
    expect(script).toContain('npm run integration:deps:init:keycloak');
    expect(script).toContain('cleanup_gate_ports "${API_PORT}" "${WEB_PORT}" "release-local-precheck"');
    expect(script).toContain('api_ready=0');
    expect(script).toContain('"${INTEGRATION_API_BASE}/api/v1/workspaces"');
    expect(script).toContain('web_ready=0');
    expect(script).toContain('/en-US/login/workspace');
    expect(script).toContain('/protocol/openid-connect/token');
    expect(script).toContain('"${INTEGRATION_API_BASE}/api/v1/me/profile"');
    expect(script).toContain('public-auth gate passed');
  });

  it('keeps a successful precheck summary in the release campaign root without secrets', () => {
    expect(script).toContain('RELEASE_PRECHECK_EVIDENCE_DIR="${RELEASE_PRECHECK_EVIDENCE_DIR:-}"');
    expect(script).toContain('RELEASE_PRECHECK_EVIDENCE_DIR="${RELEASE_CAMPAIGN_ROOT}/release-local-precheck"');
    expect(script).toContain('write_precheck_success_report()');
    expect(script).toContain('"schema_version": "agentsmith.release-local-precheck/v1"');
    expect(script).toContain('"dependency_services_ready"');
    expect(script).toContain('"api_minimal_ready"');
    expect(script).toContain('"web_minimal_ready"');
    expect(script).toContain('"public_auth_token_smoke"');
    expect(script.lastIndexOf('\nwrite_precheck_success_report\n')).toBeLessThan(script.lastIndexOf('PRECHECK_STATUS=0'));
    expect(script).not.toContain('BACKEND_REAL_API_KEY_VALUE",');
    expect(script).not.toContain('ACCESS_TOKEN",');
  });

  it('does not run release-owned browser product scenarios, Agent Task gates, or Files/Runner assertions', () => {
    expect(script).not.toContain('run_clean npx playwright test');
    expect(script).not.toContain('playwright test');
    expect(script).not.toContain('e2e/integration-system-admin-entry.spec.ts');
    expect(script).not.toContain('e2e/integration-workspace-public-login.spec.ts');
    expect(script).not.toContain('e2e/integration-workspace-entry.spec.ts');
    expect(script).not.toContain('e2e/integration-workspace-publish-usable.spec.ts');
    expect(script).not.toContain('e2e/integration-workspace-settings-directory.spec.ts');
    expect(script).not.toContain('run_agent_task_backend_real_precheck');
    expect(script).not.toContain('scripts/run-internal-agent-task-real-gate.sh');
    expect(script).not.toContain('--skills-runtime');
    expect(script).not.toContain('--files-restore-continue');
    expect(script).not.toContain('run-file-library-real-gate.sh');
    expect(script).not.toContain('test:agent-task:backend-real');
    expect(script).not.toContain('test:agent-runners:lifecycle:evidence');
    expect(script).not.toContain('file_library_backend_unavailable || true');
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
