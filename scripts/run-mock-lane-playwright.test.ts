import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('run-mock-lane-playwright', () => {
  it('uses lane-local generated-root cleanup instead of global validation cleanup on exit', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain('next_generated_root_finalize_lane_cleanup');
    expect(script).not.toContain('next_generated_root_prepare_for_validation');
  });

  it('treats a non-listening dev server as unhealthy even when the pid is still alive', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain('if port_is_listening "${PORT_WEB}"; then');
    expect(script).toContain('return 1');

    const isServerAliveIndex = script.indexOf('is_server_alive()');
    const portCheckIndex = script.indexOf('if port_is_listening "${PORT_WEB}"; then');

    expect(isServerAliveIndex).toBeGreaterThanOrEqual(0);
    expect(portCheckIndex).toBeGreaterThan(isServerAliveIndex);
  });

  it('watches Playwright attempts for mid-run listener collapse and terminates them for retry', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain('tail --pid="${PLAYWRIGHT_PID}" -n +1 -f "${LAST_PLAYWRIGHT_LOG}"');
    expect(script).toContain('mock lane web on :${PORT_WEB} stopped listening during playwright execution; terminating current attempt for retry');
    expect(script).toContain('PLAYWRIGHT_WATCHDOG_SIGNAL_FILE');
    expect(script).toContain("printf 'listener_lost\\n' > \"${PLAYWRIGHT_WATCHDOG_SIGNAL_FILE}\"");
    expect(script).toContain('did_playwright_watchdog_trip');
    expect(script).toContain('kill -TERM "${PLAYWRIGHT_PID}"');
    expect(script).toContain('PLAYWRIGHT_WATCHDOG_PID');
  });

  it('registers lane ownership and a next-dev exit marker for infra observability', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain('NEXT_DEV_EXIT_MARKER_FILE="${MOCK_STATE_DIR}/next-dev-exit.json"');
    expect(script).toContain('next_generated_root_write_lane_owner "${MOCK_RUN_ROOT}" "mock-lane" "$$" "run-mock-lane-playwright.sh"');
    expect(script).toContain('next_generated_root_clear_lane_owner "${MOCK_RUN_ROOT}"');
  });
});
