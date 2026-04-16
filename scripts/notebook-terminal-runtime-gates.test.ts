import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCanonicalStoryCatalog } from './story-catalog-support';

function extractFunctionBody(source: string, functionName: string): string {
  const signature = `${functionName}() {`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`missing function: ${functionName}`);
  }

  let depth = 0;
  let bodyStart = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      if (bodyStart === -1) {
        bodyStart = index + 1;
      }
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index);
      }
    }
  }

  throw new Error(`unterminated function: ${functionName}`);
}

describe('notebook terminal runtime gates', () => {
  it('keeps the external and internal smokes focused on multi-session coexistence and task release', async () => {
    const externalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-internal-real-smoke.sh'),
      'utf-8',
    );

    for (const source of [externalSmoke, internalSmoke]) {
      expect(source).toContain('/terminal/sessions');
      expect(source).toContain('session-one');
      expect(source).toContain('session-two');
      expect(source).toContain('SESSION_VAR_SECOND=unset');
      expect(source).toContain("method: 'GET'");
      expect(source).toContain("method: 'DELETE'");
      expect(source).toContain('remaining_after_first_close');
      expect(source).toContain('remaining_after_last_close');
      expect(source).toContain('task released after last terminal session');
    }

    expect(externalSmoke).toContain("const expectedWorkspaceRoot = `${process.env.HOME || ''}/ags-workspace/${taskId}`;");
    expect(externalSmoke).toContain("if (!first.state.output.includes(expectedWorkspaceRoot))");
    expect(externalSmoke).not.toContain('/home/percy/ags-workspaces/');
    expect(externalSmoke).not.toContain("&& !first.state.output.includes('/workspace')");
  });

  it('runs the runtime matrix before the UX gate so UI evidence sits on top of terminal session truth', async () => {
    const uxGate = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-ux-real-gate.sh'),
      'utf-8',
    );
    const matrixGate = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-matrix-real-gate.sh'),
      'utf-8',
    );

    expect(uxGate).toContain('scripts/notebook-terminal-matrix-real-gate.sh');
    expect(uxGate).not.toContain('scripts/notebook-terminal-internal-real-smoke.sh');
    expect(uxGate).toContain('npx playwright test --config playwright.config.integration.ts e2e/integration-notebook-terminal-ux.spec.ts');
    expect(uxGate).toContain('scripts/local-manual/down.sh');
    expect(uxGate).toContain('trap');
    expect(matrixGate).toContain('external_terminal_smoke');
    expect(matrixGate).toContain('internal_terminal_smoke');
    expect(matrixGate).toContain('multi-session');
    expect(matrixGate).toContain('source "${ROOT_DIR}/scripts/local-manual/common.sh"');
    expect(matrixGate).toContain('local_manual_platform_is_ready');
    expect(matrixGate).toContain('scripts/juicefs-orphan-preflight.ts');
    expect(matrixGate).toContain('internal_runtime_ready_for_retry()');
    expect(matrixGate).toContain('run_internal_terminal_smoke()');
    expect(matrixGate).toContain('bash scripts/local-manual/internal-down.sh >/dev/null');
    expect(matrixGate).toContain("grep -q '^Internal mode: enabled$'");
    expect(matrixGate).toContain("grep -q '^Runner socket: connected$'");
    expect(matrixGate).toContain('internal state missing before retry; rebuilding local-manual internal runtime');
    expect(matrixGate).toContain('scripts/local-manual/down.sh');
    expect(matrixGate).toContain('trap');
    expect(matrixGate).toContain('local-manual platform missing; starting it before seeding notebook demo');
    expect(matrixGate).toContain('scripts/local-manual/up.sh');
    expect(matrixGate).not.toContain('local-manual/proxy.ready');
    expect(matrixGate.indexOf('bash scripts/local-manual/seed-notebook-demo.sh')).toBeGreaterThanOrEqual(0);
    expect(matrixGate.indexOf('bash scripts/local-manual/start-runner.sh')).toBeGreaterThanOrEqual(0);
    expect(matrixGate.indexOf('scripts/juicefs-orphan-preflight.ts')).toBeLessThan(
      matrixGate.indexOf('bash scripts/local-manual/seed-notebook-demo.sh'),
    );
    expect(matrixGate.indexOf('bash scripts/local-manual/seed-notebook-demo.sh')).toBeLessThan(
      matrixGate.indexOf('bash scripts/local-manual/start-runner.sh'),
    );
    expect(matrixGate.lastIndexOf('bash scripts/local-manual/seed-notebook-demo.sh')).toBeGreaterThan(
      matrixGate.indexOf('bash scripts/local-manual/internal-down.sh >/dev/null'),
    );
    expect(matrixGate).not.toContain('if [[ "${label}" == "external_terminal_smoke" ]]; then');
    expect(matrixGate).not.toContain("seed-notebook-demo.sh >/dev/null 2>&1 || true");
    expect(matrixGate).not.toContain('run_with_retry internal_terminal_smoke env SKIP_INTERNAL_UP=1 bash scripts/notebook-terminal-internal-real-smoke.sh');
  });

  it('starts the local manual runner from backend-real state instead of requiring raw runner env', async () => {
    const startRunner = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/start-runner.sh'),
      'utf-8',
    );
    const localManualCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/common.sh'),
      'utf-8',
    );
    const stopProcesses = extractFunctionBody(localManualCommon, 'stop_local_manual_processes');

    expect(startRunner).toContain('make notebook-agent-runner');
    expect(startRunner).not.toContain('exec make notebook-runner');
    expect(startRunner).not.toContain("stop_matching_processes 'make notebook-agent-runner'");
    expect(startRunner).toContain('trap');
    expect(startRunner).toContain('stop_local_manual_runner_owner_aware');
    expect(startRunner).toContain('runner ownership is unverified');
    expect(localManualCommon).toContain('owner-janitor.ts');
    expect(localManualCommon).toContain('LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE');
    expect(stopProcesses).toContain('stop_local_manual_runner_owner_aware');
    expect(stopProcesses).not.toContain('stop_matching_processes');
    expect(stopProcesses).not.toContain('stop_listeners_on_port');
  });

  it('runs stale JuiceFS preflight before rebuilding the local-manual world so developer gates clear only historical leftovers', async () => {
    const localManualUp = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/up.sh'),
      'utf-8',
    );
    const localManualCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/common.sh'),
      'utf-8',
    );

    expect(localManualCommon).toContain('run_juicefs_orphan_preflight()');
    expect(localManualCommon).toContain('local_manual_platform_ready_state()');
    expect(localManualCommon).toContain('local_manual_platform_is_ready()');
    expect(localManualCommon).toContain('LOCAL_MANUAL_SKIP_JUICEFS_ORPHAN_PREFLIGHT');
    expect(localManualCommon).toContain('scripts/juicefs-orphan-preflight.ts');
    expect(localManualCommon).toContain('runner_socket_health_state()');
    expect(localManualCommon).toContain('ensure_local_manual_runner_connected()');
    expect(localManualCommon).toContain('local_manual_runner_health_monitor_once()');
    expect(localManualCommon).toContain("schema_version: 2");
    expect(localManualCommon).toContain('shutting_down');
    expect(localManualCommon).toContain('stale');
    expect(localManualUp).toContain('run_juicefs_orphan_preflight "local-manual-up"');
    expect(localManualUp.indexOf('run_juicefs_orphan_preflight "local-manual-up"')).toBeLessThan(
      localManualUp.indexOf('scripts/substrate/up.sh'),
    );
  });

  it('forwards resolved agent websocket credentials from notebook-agent-runner into the real runner launch', async () => {
    const makefile = await readFile(
      path.resolve(process.cwd(), 'Makefile'),
      'utf-8',
    );

    expect(makefile).toContain('notebook-agent-runner:');
    expect(makefile).toContain('WS_URL="$${AGENT_WS_URL');
    expect(makefile).toContain('AGENT_KEY_VALUE="$${AGENT_KEY');
    expect(makefile).toContain(
      'AGENT_WS_URL="$$WS_URL" \\',
    );
    expect(makefile).toContain(
      'AGENT_KEY="$$AGENT_KEY_VALUE" \\',
    );
    expect(makefile).toContain(
      'AGENT_WS_URL="$$WS_URL" \\\n\tAGENT_KEY="$$AGENT_KEY_VALUE" \\\n\t$(MAKE) notebook-runner',
    );
  });

  it('keeps the UX gate focused on reload/re-entry hydration and same-task recovery so backend session truth survives interruptions', async () => {
    const uxSpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(uxSpec).toContain("captureTerminalTrace(page, 'reload-task-and-preserve-backend-session-ids')");
    expect(uxSpec).toContain("captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist')");
    expect(uxSpec).toContain("loadStoryDefinitionSync('notebook-terminal-truth-unavailable-retry')");
    expect(uxSpec).toContain("captureTruthUnavailableTrace(page, 'return-to-task-while-terminal-truth-is-unavailable')");
    expect(uxSpec).toContain("captureTruthUnavailableTrace(page, 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing')");
    expect(uxSpec).toContain("captureTruthUnavailableTrace(page, 'retry-terminal-truth-check-from-blocked-task')");
    expect(uxSpec).toContain("captureTruthUnavailableTrace(page, 'unlock-task-after-terminal-truth-recovers')");
    expect(uxSpec).toContain("captureTerminalTrace(page, 'reopen-terminal-workspace-after-reload')");
    expect(uxSpec).toContain('createTerminalSessionViaApi(');
    expect(uxSpec).toContain("page.reload({ waitUntil: 'domcontentloaded' })");
    expect(uxSpec).toContain("Open Terminal Workspace");
    expect(uxSpec).toContain("End All Sessions");
    expect(uxSpec).toContain("waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 2)");
    expect(uxSpec).toContain("waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 3)");
    expect(uxSpec).toContain("await expect(terminalWorkspace).not.toContainText('Failed')");
    expect(uxSpec).toContain("message: 'task_terminal_sessions_active'");
    expect(uxSpec).not.toContain("captureTerminalTrace(page, 'reload-task-and-restore-terminal-truth')");
  });

  it('keeps local-manual status and verification aligned with current runner socket health instead of ready-file-only state', async () => {
    const status = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/status.sh'),
      'utf-8',
    );
    const appStatus = await readFile(
      path.resolve(process.cwd(), 'scripts/app/status.sh'),
      'utf-8',
    );
    const internalStatus = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-status.sh'),
      'utf-8',
    );
    const verifyNotebookDemo = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/verify-notebook-demo.sh'),
      'utf-8',
    );
    const realSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-real-smoke.sh'),
      'utf-8',
    );
    const internalSmoke = await readFile(
      path.resolve(process.cwd(), 'scripts/notebook-terminal-internal-real-smoke.sh'),
      'utf-8',
    );
    const internalCommon = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-common.sh'),
      'utf-8',
    );
    const internalUp = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/internal-up.sh'),
      'utf-8',
    );

    expect(status).toContain('runner_socket_health_state');
    expect(appStatus).toContain('runner_socket_health_state');
    expect(appStatus).not.toContain('RUNNER_READY_FILE');
    expect(internalStatus).toContain('Runner socket:');
    expect(internalStatus).toContain('runner_socket_health_state');
    expect(verifyNotebookDemo).toContain('runner_socket_is_connected');
    expect(realSmoke).toContain('runner_socket_is_connected');
    expect(realSmoke).toContain('ensure_local_manual_runner_connected');
    expect(realSmoke).toContain('task_runner_offline');
    expect(internalSmoke).toContain('INTERNAL_RUNTIME_CLEANUP_MARKER');
    expect(internalSmoke).toContain('restartInternalRuntime()');
    expect(internalSmoke).toContain('task_terminal_internal_runtime_unavailable');
    expect(internalSmoke).toContain('task_runner_offline');
    expect(internalCommon).toContain('notebook demo state missing after internal API restart; reseeding notebook demo resources');
    expect(internalCommon).toContain('ensure_notebook_demo_seeded');
    expect(internalCommon).toContain('restore_local_manual_external_mode()');
    expect(internalUp).toContain('trap');
    expect(internalUp).toContain('bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart');
  });

  it('keeps local-manual web on a lane-private next output while explicitly protecting the root contract', async () => {
    const startWeb = await readFile(
      path.resolve(process.cwd(), 'scripts/local-manual/start-web.sh'),
      'utf-8',
    );

    expect(startWeb).toContain("NEXT_DIST_DIR='${LOCAL_MANUAL_NEXT_DIST_DIR}'");
    expect(startWeb).toContain("NEXT_GENERATED_ROOT_MANAGED='1'");
    expect(startWeb).toContain("NEXT_GENERATED_ROOT_STATE_DIR='${LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR}'");
  });

  it('keeps the notebook terminal story catalog gated around canonical workspace and recovery journeys', async () => {
    const { stories, generatedSpecs } = await loadCanonicalStoryCatalog();
    const notebookTerminalStories = stories.filter((story) => story.storyId.startsWith('notebook-terminal-'));
    const notebookTerminalSpecs = generatedSpecs.filter((story) => story.storyId.startsWith('notebook-terminal-'));

    expect(notebookTerminalStories.map((story) => story.storyId)).toEqual([
      'notebook-terminal-reentry-recovery',
      'notebook-terminal-truth-unavailable-retry',
      'notebook-terminal-workspace-multi-session',
    ]);
    expect(notebookTerminalSpecs.map((story) => story.storyId)).toEqual(
      notebookTerminalStories.map((story) => story.storyId),
    );
    expect(notebookTerminalStories.every((story) => story.family === 'notebook-terminal-workspace')).toBe(true);
    expect(notebookTerminalStories.every((story) => story.gatePolicy.requiredEvidence.includes('trace'))).toBe(true);
  });
});
