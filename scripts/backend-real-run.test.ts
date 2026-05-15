import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('backend real run first-lane port contract', () => {
  it('keeps backend-real runner shell scripts syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/backend-real-run.sh'])).not.toThrow();
    expect(() => execFileSync('bash', ['-n', 'scripts/agent-task-real-smoke-gate.sh'])).not.toThrow();
    expect(() => execFileSync('bash', ['-n', 'scripts/files-restore-continuation-real-gate.sh'])).not.toThrow();
  });

  it('resolves the first lane from inherited integration ports before cleanup and execution', () => {
    const script = readFileSync('scripts/backend-real-run.sh', 'utf8');

    expect(script).toContain('FIRST_LANE_API_PORT="${INTEGRATION_API_PORT:-20040}"');
    expect(script).toContain('FIRST_LANE_WEB_PORT="${INTEGRATION_WEB_PORT:-3041}"');
    expect(script).toContain(
      'cleanup_gate_ports "${FIRST_LANE_API_PORT}" "${FIRST_LANE_WEB_PORT}" e2e/integration-minimal.spec.ts',
    );
    expect(script).toContain('INTEGRATION_API_PORT="${FIRST_LANE_API_PORT}"');
    expect(script).toContain('INTEGRATION_WEB_PORT="${FIRST_LANE_WEB_PORT}"');
    expect(script).not.toContain('cleanup_gate_ports 20040 3041 e2e/integration-minimal.spec.ts');
  });

  it('restores caller-provided integration ports after runtime env defaults load and before first-lane resolution', () => {
    const script = readFileSync('scripts/backend-real-run.sh', 'utf8');

    const originalApiCapture = 'ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"';
    const originalWebCapture = 'ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"';
    const runtimeLoad = 'load_backend_real_env';
    const restoreApi = 'export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"';
    const restoreWeb = 'export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"';
    const firstLaneApi = 'FIRST_LANE_API_PORT="${INTEGRATION_API_PORT:-20040}"';
    const firstLaneWeb = 'FIRST_LANE_WEB_PORT="${INTEGRATION_WEB_PORT:-3041}"';

    expect(script).toContain(originalApiCapture);
    expect(script).toContain(originalWebCapture);
    expect(script).toContain(restoreApi);
    expect(script).toContain(restoreWeb);

    expect(script.indexOf(originalApiCapture)).toBeLessThan(script.indexOf(runtimeLoad));
    expect(script.indexOf(originalWebCapture)).toBeLessThan(script.indexOf(runtimeLoad));
    expect(script.indexOf(restoreApi)).toBeGreaterThan(script.indexOf(runtimeLoad));
    expect(script.indexOf(restoreWeb)).toBeGreaterThan(script.indexOf(runtimeLoad));
    expect(script.indexOf(restoreApi)).toBeLessThan(script.indexOf(firstLaneApi));
    expect(script.indexOf(restoreWeb)).toBeLessThan(script.indexOf(firstLaneWeb));
  });

  it('reuses default gate preflight and focused visual evidence only when the release env explicitly opts in', () => {
    const script = readFileSync('scripts/backend-real-run.sh', 'utf8');

    expect(script).toContain('REUSE_DEFAULT_GATE_EVIDENCE="${BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE:-0}"');
    expect(script).toContain('if [[ "${REUSE_DEFAULT_GATE_EVIDENCE}" == "1" ]]; then');
    expect(script).toContain('bash scripts/workspace-project-default-gate.sh --with-backend-real --skip-shared-preflight --skip-focused-visual');
    expect(script).toContain('npm run test:backend-real:core');
    expect(script).toContain('AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT=1');
    expect(script).toContain('npm run test:agent-task:backend-real:smoke');
  });

  it('keeps focused Files restore continuation out of backend-real core direct integration entrypoints', () => {
    const script = readFileSync('scripts/backend-real-run.sh', 'utf8');

    expect(script).not.toContain('running file library user-story restore continuation');
    expect(script).not.toContain('cleanup_gate_ports 21020 3121 e2e/integration-files-user-stories.spec.ts');
    expect(script).not.toContain('npm run test:e2e:integration:files:user-stories:restore-continue');
    expect(script).not.toContain('AFSCP_RESTORE_RECOVERY_ENABLED');
    expect(script).toContain('npm run test:internal:backend-real:agent-task-workspace');
  });

  it('keeps agent-task smoke static preflight by default and skippable only by explicit flag or env', () => {
    const script = readFileSync('scripts/agent-task-real-smoke-gate.sh', 'utf8');

    expect(script).toContain('SKIP_SHARED_PREFLIGHT="${AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT:-0}"');
    expect(script).toContain('--skip-shared-preflight');
    expect(script).toContain('if [[ "${SKIP_SHARED_PREFLIGHT}" == "1" ]]; then');
    expect(script).toContain('reusing shared preflight evidence; skipping contracts/openapi/typegen/typecheck');
    expect(script).toContain('run_cmd "npm run contracts:check"');
    expect(script).toContain('run_cmd "npm run contracts:check-openapi"');
    expect(script).toContain('run_cmd "npm run openapi:check-generated"');
    expect(script).toContain('run_cmd "npx next typegen ."');
    expect(script).toContain('run_cmd "npx tsc --noEmit"');
  });
});
