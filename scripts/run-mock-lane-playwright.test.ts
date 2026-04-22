import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('run-mock-lane-playwright', () => {
  it('stays shell-syntax valid so visual wrapper regressions fail before Playwright starts', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-mock-lane-playwright.sh'])).not.toThrow();
  });

  it('forces strict MSW readiness for both the mock web server and the Playwright child lane', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const serverLaunchIndex = script.indexOf('start_mock_server() {');
    const serverStrictReadyIndex = script.indexOf('NEXT_PUBLIC_MSW_STRICT_READY=true');
    const playwrightLaunchIndex = script.indexOf('run_playwright_once() {');
    const playwrightStrictReadyIndex = script.lastIndexOf('NEXT_PUBLIC_MSW_STRICT_READY=true');

    expect(serverLaunchIndex).toBeGreaterThanOrEqual(0);
    expect(serverStrictReadyIndex).toBeGreaterThan(serverLaunchIndex);
    expect(playwrightLaunchIndex).toBeGreaterThanOrEqual(0);
    expect(playwrightStrictReadyIndex).toBeGreaterThan(playwrightLaunchIndex);
    expect(script.match(/NEXT_PUBLIC_MSW_STRICT_READY=true/g)).toHaveLength(2);
  });

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

  it('passes the owning run root to the managed Next.js child so validation does not block its parent lane', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain('NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${MOCK_RUN_ROOT}"');
    expect(script.indexOf('NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT="${MOCK_RUN_ROOT}"')).toBeLessThan(
      script.indexOf('bash scripts/run-next-dev-safe.sh --port "${PORT_WEB}"'),
    );
  });

  it('warms the English login entry and slow workspace routes before Playwright starts', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');

    expect(script).toContain("WARM_URLS_DEFAULT=$'/zh-CN/login\\n/en-US/login\\n/en-US/login/workspace");
    expect(script.indexOf('/en-US/login\\n/en-US/login/workspace')).toBeGreaterThanOrEqual(0);
    expect(script).toContain('/en-US/workspaces/ws_default');
    expect(script).toContain('/en-US/workspaces/ws_default/settings');
  });

  it('accepts login redirects as successful warm-route responses', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const warmRouteIndex = script.indexOf('warm_route() {');
    const acceptedStatusIndex = script.indexOf('if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then');

    expect(warmRouteIndex).toBeGreaterThanOrEqual(0);
    expect(acceptedStatusIndex).toBeGreaterThan(warmRouteIndex);
  });
});
