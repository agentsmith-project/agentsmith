import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(matrixGate).toContain('external_terminal_smoke');
    expect(matrixGate).toContain('internal_terminal_smoke');
    expect(matrixGate).toContain('multi-session');
  });

  it('keeps the UX gate focused on reload/re-entry hydration so backend session truth survives page refreshes', async () => {
    const uxSpec = await readFile(
      path.resolve(process.cwd(), 'e2e/integration-notebook-terminal-ux.spec.ts'),
      'utf-8',
    );

    expect(uxSpec).toContain("captureTerminalTrace(page, 'reload-task-and-restore-terminal-truth')");
    expect(uxSpec).toContain("captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist')");
    expect(uxSpec).toContain("captureTerminalTrace(page, 'reopen-terminal-workspace-after-reload')");
    expect(uxSpec).toContain('createTerminalSessionViaApi(');
    expect(uxSpec).toContain("page.reload({ waitUntil: 'domcontentloaded' })");
    expect(uxSpec).toContain("Open Terminal Workspace");
    expect(uxSpec).toContain("End All Sessions");
    expect(uxSpec).toContain("waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 2)");
    expect(uxSpec).toContain("waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 3)");
    expect(uxSpec).toContain("await expect(terminalWorkspace).not.toContainText('Failed')");
    expect(uxSpec).toContain("message: 'task_terminal_sessions_active'");
  });
});
