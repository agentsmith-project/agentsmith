import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateFocusedVisualSelection } from './focused-visual-selection';

describe('run-mock-lane-playwright', () => {
  it('stays shell-syntax valid so visual wrapper regressions fail before Playwright starts', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-mock-lane-playwright.sh'])).not.toThrow();
  });

  it('keeps the shared mock lane session adapter shell-syntax valid', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-mock-lane-session.sh'])).not.toThrow();
  });

  it('routes aggregate mock npm entries through the session adapter without changing single-project diagnostics', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:e2e']).toBe('bash scripts/run-mock-lane-session.sh --preset=default');
    expect(packageJson.scripts?.['test:e2e:all']).toBe('bash scripts/run-mock-lane-session.sh --preset=with-visual');
    expect(packageJson.scripts?.['test:e2e:lane:mock:chromium']).toBe(
      'bash scripts/run-mock-lane-session.sh --shards=chromium,chromium-serial',
    );
    expect(packageJson.scripts?.['test:e2e:lane:mock:chromium']).not.toContain('run-mock-lane-playwright.sh');
    expect(packageJson.scripts?.['test:e2e:lane:mock:chromium']).not.toContain('&&');
    expect(packageJson.scripts?.['test:e2e:lane:mock:full:with-visual']).toBe(
      'bash scripts/run-mock-lane-session.sh --preset=with-visual',
    );
    expect(packageJson.scripts?.['test:e2e:lane:mock:smoke']).toContain('scripts/run-mock-lane-playwright.sh');
    expect(packageJson.scripts?.['test:e2e:lane:mock:visual']).toContain('scripts/run-mock-lane-playwright.sh');
    expect(packageJson.scripts?.['test:e2e:lane:mock:visual:update']).toContain('scripts/run-mock-lane-playwright.sh');
    expect(packageJson.scripts?.['test:e2e:lane:mock:visual:update']).not.toContain('run-mock-lane-session.sh');
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
    expect(script).toContain('/en-US/user/third-party-accounts');
  });

  it('accepts login redirects as successful warm-route responses', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const warmRouteIndex = script.indexOf('warm_route() {');
    const acceptedStatusIndex = script.indexOf('if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then');

    expect(warmRouteIndex).toBeGreaterThanOrEqual(0);
    expect(acceptedStatusIndex).toBeGreaterThan(warmRouteIndex);
  });

  it('requires explicit allow-empty selection before short-circuiting empty grep selections', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const probeIndex = script.indexOf('playwright_args_request_empty_selection_probe()');
    const selectionCallIndex = script.indexOf('if handle_empty_playwright_selection "${PLAYWRIGHT_ARGS[@]}"; then');
    const startServerIndex = script.indexOf('start_mock_server\nwrite_visual_build_info');

    expect(probeIndex).toBeGreaterThanOrEqual(0);
    expect(script).toContain('npx playwright test "$@" --list');
    expect(script).toContain('Total: 0 tests in 0 files');
    expect(script).toContain('playwright_empty_selection_allowed "$@"');
    expect(script).toContain('MOCK_LANE_ALLOW_EMPTY_SELECTION');
    expect(script).toContain('--allow-empty-selection');
    expect(script).toContain('"status": "${evidence_status}"');
    expect(script).toContain('"selection": "${selection}"');
    expect(script).toContain('"passed"');
    expect(script).toContain('"failed"');
    expect(script).toContain('"empty_allowed"');
    expect(script).toContain('"empty_disallowed"');
    expect(script).toContain('"helper_version": "${PLAYWRIGHT_EMPTY_SELECTION_HELPER_VERSION}"');
    expect(script).toContain('"argv": ${argv_json},');
    expect(script).toContain('"grep": ${grep_json},');
    expect(script).toContain('"project": ${project_json},');
    expect(script).toContain('"matched_count": ${matched_count},');
    expect(script).toContain("node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' -- \"$@\"");
    expect(script).toContain("' -- \"${long_name}\" \"${short_name}\" \"$@\"");
    expect(script).not.toContain('"status": "skipped"');
    expect(script).not.toContain('"selection": "skipped"');
    expect(selectionCallIndex).toBeGreaterThan(probeIndex);
    expect(startServerIndex).toBeGreaterThan(selectionCallIndex);
  });

  it('validates focused visual expected scenario/theme sets before empty-selection handling and mock server startup', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const focusedValidationIndex = script.indexOf('validate_focused_visual_selection "${PLAYWRIGHT_ARGS[@]}"');
    const emptySelectionIndex = script.indexOf('handle_empty_playwright_selection "${PLAYWRIGHT_ARGS[@]}"');
    const startServerIndex = script.indexOf('start_mock_server\nwrite_visual_build_info');

    expect(script).toContain('PLAYWRIGHT_FOCUSED_VISUAL_EXPECTED_SET');
    expect(script).toContain('PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_EVIDENCE_FILE');
    expect(script).toContain('--focused-visual-expected-set');
    expect(script).toContain('scripts/focused-visual-selection.ts');
    expect(script).toContain('--allow-empty-requested');
    expect(focusedValidationIndex).toBeGreaterThanOrEqual(0);
    expect(emptySelectionIndex).toBeGreaterThan(focusedValidationIndex);
    expect(startServerIndex).toBeGreaterThan(emptySelectionIndex);
  });

  it('writes focused visual list evidence to the durable focused visual selection artifact dir', () => {
    const script = readFileSync('scripts/run-mock-lane-playwright.sh', 'utf8');
    const focusedValidationStart = script.indexOf('validate_focused_visual_selection() {');
    const focusedValidationEnd = script.indexOf('prepare_playwright_args "$@"');
    const focusedValidationBody = script.slice(focusedValidationStart, focusedValidationEnd);

    expect(script).toContain(
      'PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_LIST_LOG="${PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_DIR}/playwright-list.log"',
    );
    expect(focusedValidationBody).toContain('mkdir -p "${PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_DIR}"');
    expect(focusedValidationBody).toContain(': > "${PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_LIST_LOG}"');
    expect(focusedValidationBody).toContain(') >"${PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_LIST_LOG}" 2>&1');
    expect(focusedValidationBody).toContain('--list-log "${PLAYWRIGHT_FOCUSED_VISUAL_SELECTION_LIST_LOG}"');
    expect(focusedValidationBody).not.toContain('--list-log "${PLAYWRIGHT_SELECTION_LIST_LOG}"');
  });

  it('fails focused visual validation when a non-empty grep selection misses expected scenario/theme entries', () => {
    const result = evaluateFocusedVisualSelection({
      expectedSet: [
        'workspace-home-project-creator:default',
        'projects-list:default',
        'workspace-overview:dark',
        'workspace-overview:light',
        'overview:dark',
        'overview:light',
      ],
      listExitCode: 0,
      allowEmptySelectionRequested: false,
      listOutput: [
        'Listing tests:',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › project_pages / overview › overview [dark]',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › project_pages / overview › overview [light]',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › workspace_pages / workspace-overview › workspace-overview [dark]',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › workspace_pages / workspace-overview › workspace-overview [light]',
        'Total: 4 tests in 1 file',
      ].join('\n'),
    });

    expect(result.status).toBe('failed');
    expect(result.matchedSet.map((entry) => entry.key)).toEqual([
      'overview:dark',
      'overview:light',
      'workspace-overview:dark',
      'workspace-overview:light',
    ]);
    expect(result.missingSet.map((entry) => entry.key)).toEqual([
      'projects-list:default',
      'workspace-home-project-creator:default',
    ]);
    expect(result.extraSet).toEqual([]);
  });

  it('fails focused visual validation when grep selects scenarios outside the allowlist', () => {
    const result = evaluateFocusedVisualSelection({
      expectedSet: ['members:dark', 'members:light'],
      listExitCode: 0,
      allowEmptySelectionRequested: false,
      listOutput: [
        'Listing tests:',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › governance_pages / members › members [dark]',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › governance_pages / members › members [light]',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › governance_pages / resource-policy › resource-policy [dark]',
        'Total: 3 tests in 1 file',
      ].join('\n'),
    });

    expect(result.status).toBe('failed');
    expect(result.missingSet).toEqual([]);
    expect(result.extraSet.map((entry) => entry.key)).toEqual(['resource-policy:dark']);
  });

  it('does not let allow-empty selection bypass focused visual expected-set validation', () => {
    const result = evaluateFocusedVisualSelection({
      expectedSet: ['members:dark'],
      listExitCode: 0,
      allowEmptySelectionRequested: true,
      listOutput: [
        'Listing tests:',
        '  [visual] › visual.spec.ts:2724:9 › Visual - Story Catalog Scenes › governance_pages / members › members [dark]',
        'Total: 1 test in 1 file',
      ].join('\n'),
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('focused_visual_disallows_allow_empty_selection');
    expect(result.matchedSet.map((entry) => entry.key)).toEqual(['members:dark']);
  });
});
