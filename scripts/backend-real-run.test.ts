import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('backend real run first-lane port contract', () => {
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
});
