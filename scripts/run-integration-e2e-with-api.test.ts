import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('integration e2e with API runtime ownership contract', () => {
  it('starts the local API through run-scoped ownership and stops the owned process tree', () => {
    const script = readFileSync('scripts/run-integration-e2e-with-api.sh', 'utf8');

    expect(script).toContain('scripts/lib/local-runtime-processes.sh');
    expect(script).toMatch(/LOCAL_RUNTIME_RUN_ID="\$\{INTEGRATION_RUN_ID\}"/);
    expect(script).toMatch(/LOCAL_RUNTIME_LINE_KIND="backend_real"/);
    expect(script).toMatch(/LOCAL_RUNTIME_OWNER_TOKEN="\$\{INTEGRATION_RUN_ID\}:backend_real:/);
    expect(script).toMatch(/LOCAL_RUNTIME_PROCESS_STATE_DIR="\$\{INTEGRATION_RUN_ROOT\}\/processes"/);
    expect(script).toContain('local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}"');
    expect(script).toContain('API_PID="$(local_runtime_capture_authoritative_service_pid "${API_ROOT_PID}" api "${API_PORT}" 60)"');
    expect(script).toContain('local_runtime_stop_owned_process_tree "${API_ROOT_PID}" api "${API_PORT}"');
    expect(script).toContain('local_runtime_wait_port_free "${API_PORT}" api');

    expect(script).not.toMatch(/\n\s*kill "\$\{API_PID\}"/);
  });
});
