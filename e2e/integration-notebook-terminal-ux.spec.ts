import { expect, test, type Locator, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createFileLibraryViaUi,
  createNotebookTaskViaApi,
  createTerminalSessionViaApi as createTerminalSessionViaApiWithWs,
  createProjectInWorkspace,
  expectNotebookTaskConversationSurface,
  keycloakLoginToWorkspace,
  listTerminalSessionsViaApi,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID ?? 'ws_default';
const NOTEBOOK_TERMINAL_STORY = loadStoryDefinitionSync('notebook-terminal-workspace-multi-session');
const NOTEBOOK_TERMINAL_BINDING = buildTraceStoryBinding(NOTEBOOK_TERMINAL_STORY);
const NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY = loadStoryDefinitionSync('notebook-terminal-truth-unavailable-retry');
const NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_BINDING = buildTraceStoryBinding(NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY);
const NOTEBOOK_TERMINAL_RECOVERY_STORY = loadStoryDefinitionSync('notebook-terminal-reentry-recovery');
const NOTEBOOK_TERMINAL_RECOVERY_BINDING = buildTraceStoryBinding(NOTEBOOK_TERMINAL_RECOVERY_STORY);

type TerminalReadyTask = {
  projectId: string;
  taskId: string;
  agentId: string;
  runnerBundle: {
    wsUrl: string;
    agentKey: string;
  };
  runner: Awaited<ReturnType<typeof startCodexRunnerProcess>>;
};

type ListedTerminalSessionsResponse = Awaited<ReturnType<typeof listTerminalSessionsViaApi>>;
type ListedTerminalSession = ListedTerminalSessionsResponse['items'][number];

const TRANSIENT_TERMINAL_SESSION_TRANSPORT_ERRORS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_FAILED',
  'Network request failed',
  'socket hang up',
  'apiRequestContext.get:',
] as const;
const TERMINAL_SESSION_COUNT_UNAVAILABLE = -1;
const TERMINAL_SESSION_STATUS_UNAVAILABLE = '__terminal_session_transport_unavailable__';

function isTransientTerminalSessionTransportError(error: unknown): boolean {
  const errorText = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return TRANSIENT_TERMINAL_SESSION_TRANSPORT_ERRORS.some((token) => errorText.includes(token));
}

async function listTerminalSessionsViaApiForPolling(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<ListedTerminalSessionsResponse | null> {
  try {
    return await listTerminalSessionsViaApi(args);
  } catch (error) {
    // Backend-real local/manual recovery runs can briefly drop the list request
    // while the transport is reconnecting. Treat that as "not ready yet" and
    // let the surrounding poll keep the real assertion strict.
    if (isTransientTerminalSessionTransportError(error)) {
      return null;
    }
    throw error;
  }
}

function resolveTerminalStep(stepId: string) {
  const step = NOTEBOOK_TERMINAL_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_notebook_terminal_step:${stepId}`);
  }
  return step;
}

function resolveTruthUnavailableStep(stepId: string) {
  const step = NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_notebook_terminal_truth_unavailable_step:${stepId}`);
  }
  return step;
}

function resolveRecoveryStep(stepId: string) {
  const step = NOTEBOOK_TERMINAL_RECOVERY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_notebook_terminal_recovery_step:${stepId}`);
  }
  return step;
}

function requireProviderApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function prepareTerminalReadyTask(page: Page): Promise<TerminalReadyTask> {
  const providerApiKey = requireProviderApiKey();

  await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
  const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Story Notebook Terminal Workspace');
  const workspaceLibraryName = `Story Terminal Workspace ${Date.now()}`;
  const fileLibraryId = await createFileLibraryViaUi(page, WORKSPACE_ID, projectId, workspaceLibraryName);
  const credentialName = `Story Terminal Credential ${Date.now()}`;
  await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, providerApiKey);
  const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
    endpointName: `Story Terminal Endpoint ${Date.now()}`,
    endpointModel: BACKEND_REAL_MODEL,
    upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
    credentialName,
  });
  const agentBundle = await createExternalRunnerAgentBundle(page, {
    workspaceId: WORKSPACE_ID,
    projectId,
    endpointId,
    title: 'story-notebook-terminal-workspace',
  });
  const runner = await startCodexRunnerProcess({
    wsUrl: agentBundle.wsUrl,
    agentKey: agentBundle.agentKey,
  });
  await waitForAgentPresenceOnline(page, WORKSPACE_ID, projectId, agentBundle.agentId);
  const taskId = await createNotebookTaskViaApi({
    page,
    workspaceId: WORKSPACE_ID,
    projectId,
    title: `Story Notebook Terminal Task ${Date.now()}`,
    agentId: agentBundle.agentId,
    fileLibraryId,
  });

  return {
    projectId,
    taskId,
    agentId: agentBundle.agentId,
    runnerBundle: {
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    },
    runner,
  };
}

async function waitForTerminalSessionCount(page: Page, workspaceId: string, projectId: string, taskId: string, expected: number) {
  await expect
    .poll(
      async () => {
        try {
          const sessions = await listTerminalSessionsViaApiForPolling({
            page,
            workspaceId,
            projectId,
            taskId,
          });
          return sessions?.total ?? TERMINAL_SESSION_COUNT_UNAVAILABLE;
        } catch (error) {
          if (isTransientTerminalSessionTransportError(error)) {
            return TERMINAL_SESSION_COUNT_UNAVAILABLE;
          }
          throw error;
        }
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(expected);
}

async function waitForTerminalSessionIds(
  page: Page,
  workspaceId: string,
  projectId: string,
  taskId: string,
  expectedCount: number,
): Promise<string[]> {
  let sessionIds: string[] = [];
  await expect
    .poll(
      async () => {
        try {
          const sessions = await listTerminalSessionsViaApiForPolling({
            page,
            workspaceId,
            projectId,
            taskId,
          });
          if (!sessions) {
            return TERMINAL_SESSION_COUNT_UNAVAILABLE;
          }
          sessionIds = sessions.items.map((item) => item.id).sort();
          return sessionIds.length;
        } catch (error) {
          if (isTransientTerminalSessionTransportError(error)) {
            return TERMINAL_SESSION_COUNT_UNAVAILABLE;
          }
          throw error;
        }
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(expectedCount);
  return sessionIds;
}

function countTerminalRecoverySessions(sessions: ListedTerminalSession[]): number {
  return sessions.filter(
    (session) => session.status === 'failed' || session.status === 'disconnected',
  ).length;
}

function getExpectedTerminalHiddenStateCopy(count: number, recoveryCount: number): {
  summary: string;
  description: string;
  actionLabel: 'Open Terminal Workspace' | 'Reopen Terminal Workspace';
} {
  if (recoveryCount <= 0) {
    return {
      summary:
        count === 1
          ? '1 terminal session is using this task'
          : `${count} terminal sessions are using this task`,
      description:
        count === 1
          ? 'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.'
          : 'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
      actionLabel: 'Open Terminal Workspace',
    };
  }

  if (recoveryCount >= count) {
    return {
      summary:
        count === 1
          ? '1 terminal session on this task needs recovery'
          : `${count} terminal sessions on this task need recovery`,
      description:
        count === 1
          ? 'This terminal session needs recovery. Reopen it to reconnect or review the issue, or end the session before starting a new run.'
          : `${count} terminal sessions need recovery. Reopen the terminal workspace to reconnect or review the issues, or end the sessions before starting a new run.`,
      actionLabel: 'Reopen Terminal Workspace',
    };
  }

  return {
    summary: `${count} terminal sessions are using this task, ${recoveryCount} ${
      recoveryCount === 1 ? 'needs' : 'need'
    } recovery`,
    description: `${count} terminal sessions are still using this task, and ${recoveryCount} of them ${
      recoveryCount === 1 ? 'needs' : 'need'
    } recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.`,
    actionLabel: 'Reopen Terminal Workspace',
  };
}

async function expectTaskDeleteButtonBlocked(page: Page, reason: RegExp | string) {
  const deleteButton = page
    .getByTestId('notebook__task-header')
    .getByRole('button', { name: /^Delete Task$/ });
  await expect(deleteButton).toBeVisible();
  await expect(deleteButton).toBeDisabled();
  if (typeof reason === 'string') {
    await expect(deleteButton).toHaveAttribute('title', reason);
    return;
  }
  await expect(deleteButton).toHaveAttribute('title', reason);
}

async function expectTaskDeleteButtonEnabled(page: Page) {
  const deleteButton = page
    .getByTestId('notebook__task-header')
    .getByRole('button', { name: /^Delete Task$/ });
  await expect(deleteButton).toBeVisible();
  await expect(deleteButton).toBeEnabled();
}

async function expectNotebookRunBlockedByLiveTerminalSessions(
  page: Page,
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  const token = await readStoredAuthToken(page);
  expect(token).toBeTruthy();
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content: 'Please continue this notebook task after terminal work.',
      },
    },
  );

  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error_code: 'RESOURCE_CONFLICT',
    message: 'task_terminal_sessions_active',
  });
}

async function createTerminalSessionViaApi(
  page: Page,
  workspaceId: string,
  projectId: string,
  taskId: string,
  shell?: string,
) {
  const token = await readStoredAuthToken(page);
  expect(token).toBeTruthy();
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/terminal/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        cols: 120,
        rows: 30,
        ...(shell?.trim() ? { shell: shell.trim() } : {}),
      },
    },
  );

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.id ?? payload.session_id;
}

async function waitForTerminalSessionStartupFailure(
  wsUrl: string,
  expectedMessage: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close races on timeout
      }
      reject(new Error(`terminal_ws_failure_timeout:${expectedMessage}`));
    }, 30_000);

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore close races after failure resolution
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'terminal.resize', cols: 120, rows: 40 }));
    });

    ws.on('message', (raw) => {
      let payload: { type?: string; error_message?: string } | null = null;
      try {
        payload = JSON.parse(raw.toString('utf-8')) as { type?: string; error_message?: string };
      } catch {
        return;
      }
      if (payload?.type !== 'error') {
        return;
      }
      if (!payload.error_message?.includes(expectedMessage)) {
        finish(new Error(`terminal_ws_unexpected_error:${payload.error_message ?? 'unknown'}`));
        return;
      }
      finish();
    });

    ws.on('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });

    ws.on('close', (_code, reasonBuffer) => {
      if (settled) {
        return;
      }
      const reason = reasonBuffer.toString();
      finish(new Error(`terminal_ws_closed_before_failure:${reason || 'unknown'}`));
    });
  });
}

async function waitForTerminalSessionStatus(
  page: Page,
  workspaceId: string,
  projectId: string,
  taskId: string,
  sessionId: string,
  expectedStatus: 'active' | 'failed' | 'closed' | 'pending' | 'disconnected',
) {
  await expect
    .poll(
      async () => {
        try {
          const sessions = await listTerminalSessionsViaApiForPolling({
            page,
            workspaceId,
            projectId,
            taskId,
          });
          if (!sessions) {
            return TERMINAL_SESSION_STATUS_UNAVAILABLE;
          }
          return sessions.items.find((item) => item.id === sessionId)?.status ?? null;
        } catch (error) {
          if (isTransientTerminalSessionTransportError(error)) {
            return TERMINAL_SESSION_STATUS_UNAVAILABLE;
          }
          throw error;
        }
      },
      { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(expectedStatus);
}

function getTerminalTabs(page: Page) {
  return page.locator('[data-testid^="notebook__task-terminal-tab-"]');
}

async function getActiveTerminalTabId(page: Page) {
  const terminalWorkspace = page.getByTestId('notebook__task-terminal-workspace');
  await expect
    .poll(
      async () => (await terminalWorkspace.getAttribute('data-active-terminal-tab-id'))?.trim() || null,
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .not.toBeNull();

  const activeTabId = await terminalWorkspace.getAttribute('data-active-terminal-tab-id');
  if (!activeTabId) {
    throw new Error('missing_active_terminal_tab_id');
  }
  return activeTabId;
}

async function getActiveTerminalPanel(page: Page) {
  const activeTabId = await getActiveTerminalTabId(page);
  return page.getByTestId(`notebook__task-terminal-${activeTabId}`);
}

async function getActiveTerminalTab(page: Page) {
  const activeTabId = await getActiveTerminalTabId(page);
  return page.getByTestId(`notebook__task-terminal-tab-${activeTabId}`);
}

async function waitForActiveTerminalReady(
  page: Page,
  workspaceId: string,
  projectId: string,
  taskId: string,
  sessionId: string,
): Promise<Locator> {
  await waitForTerminalSessionStatus(page, workspaceId, projectId, taskId, sessionId, 'active');

  const activeTab = await getActiveTerminalTab(page);
  await expect
    .poll(
      async () => {
        const text = ((await activeTab.textContent()) ?? '').replace(/\s+/g, ' ').trim();
        return {
          text,
          readyForWork: /active/i.test(text) && !/preparing|connecting|failed/i.test(text),
        };
      },
      { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toMatchObject({ readyForWork: true });

  const panel = await getActiveTerminalPanel(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.xterm')).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator('.xterm-helper-textarea')).toBeAttached({ timeout: 30_000 });

  return panel;
}

async function runCommandInActiveTerminalViaBrowser(
  page: Page,
  command: string,
  expectedFragment: string,
  timeoutMs = 30_000,
) {
  const panel = await getActiveTerminalPanel(page);
  const terminalSurface = panel.locator('.xterm-screen');
  const terminalInput = panel.locator('.xterm-helper-textarea');
  const terminalRows = panel.locator('.xterm-rows');
  await expect(terminalSurface).toBeVisible({ timeout: 30_000 });
  await expect(terminalInput).toBeAttached({ timeout: 30_000 });
  await expect(terminalRows).toBeAttached({ timeout: 30_000 });
  await terminalSurface.click({ position: { x: 48, y: 24 } });
  await expect
    .poll(
      async () => terminalInput.evaluate((element) => document.activeElement === element),
      { timeout: 15_000, intervals: [100, 250, 500] },
    )
    .toBe(true);
  await page.keyboard.type(command, { delay: 25 });
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () => ((await terminalRows.textContent()) ?? '').replace(/\s+/g, ' ').trim(),
      { timeout: timeoutMs, intervals: [250, 500, 1_000, 2_000] },
    )
    .toContain(expectedFragment);
}

test.describe.serial('@lane-real notebook terminal workspace UX walkthrough', () => {
  test('project member switches between terminal workspace sessions and only regains agent input after the last session ends', async ({ page }, testInfo) => {
    test.setTimeout(480_000);

    const terminalTask = await prepareTerminalReadyTask(page);
    const activeRunner = terminalTask.runner;
    let runnerStopped = false;
    const stopActiveRunner = async () => {
      if (runnerStopped) {
        return;
      }
      runnerStopped = true;
      await activeRunner.stop();
    };
    test.info().annotations.push({ type: 'codex_runner_log', description: terminalTask.runner.logPath });

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-notebook-terminal-ux',
      storyId: NOTEBOOK_TERMINAL_STORY.storyId,
      title: NOTEBOOK_TERMINAL_STORY.title,
      actor: NOTEBOOK_TERMINAL_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/notebook/tasks/${terminalTask.taskId}`,
      specFile: 'e2e/integration-notebook-terminal-ux.spec.ts',
      browser: 'chromium',
      goal: NOTEBOOK_TERMINAL_STORY.goal,
      preconditions: [...(NOTEBOOK_TERMINAL_STORY.preconditions ?? [])],
      seedData: [...(NOTEBOOK_TERMINAL_STORY.seedData ?? [])],
      storyBinding: NOTEBOOK_TERMINAL_BINDING,
    });
    const captureTerminalTrace = async (pageRef: Page, stepId: string): Promise<void> => {
      const storyStep = resolveTerminalStep(stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/notebook/tasks/${terminalTask.taskId}`);
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await captureTerminalTrace(page, 'return-to-notebook-task');

      const createSessionButton = page.getByTestId('notebook__task-header-terminal-create');
      await expect(createSessionButton).toBeVisible();
      await expect(createSessionButton).toHaveText(/Open Terminal/i);
      await createSessionButton.click();

      const terminalWorkspace = page.getByTestId('notebook__task-terminal-workspace');
      await expect(terminalWorkspace).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('notebook__task-artifacts-toggle')).toHaveText(/Show Artifacts/i);
      await captureTerminalTrace(page, 'open-terminal-workspace');

      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 1);
      const firstSessionList = await listTerminalSessionsViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: terminalTask.projectId,
        taskId: terminalTask.taskId,
      });
      const firstSessionId = firstSessionList.items[0]?.id ?? null;
      expect(firstSessionId).toBeTruthy();
      await waitForActiveTerminalReady(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
        firstSessionId!,
      );
      await captureTerminalTrace(page, 'wait-for-first-terminal-session');

      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-workspace-first-session.png'), fullPage: true });

      await page.getByTestId('notebook__task-terminal-create').click();
      await expect(getTerminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 2);
      const secondSessionList = await listTerminalSessionsViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: terminalTask.projectId,
        taskId: terminalTask.taskId,
      });
      const secondSessionIds = secondSessionList.items.map((item) => item.id);
      expect(new Set(secondSessionIds).size).toBe(2);
      expect(secondSessionIds).toContain(firstSessionId);
      const secondSessionId = secondSessionIds.find((id) => id !== firstSessionId) ?? null;
      expect(secondSessionId).toBeTruthy();
      await waitForActiveTerminalReady(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
        secondSessionId!,
      );
      await captureTerminalTrace(page, 'create-second-terminal-session');

      const thirdSessionId = await createTerminalSessionViaApi(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
      );
      expect(thirdSessionId).toBeTruthy();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 3);
      const liveSessionIdsBeforeReload = await waitForTerminalSessionIds(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
        3,
      );
      const sessionLimitMessage = 'You can run up to 3 terminal sessions in one task.';
      const createSessionAtLimitButton = page.getByTestId('notebook__task-terminal-create');
      await createSessionAtLimitButton.evaluate((button) => {
        if (button instanceof HTMLButtonElement) {
          button.click();
        }
      });
      const surfacedSessionLimitMessage = await page.getByText(sessionLimitMessage).isVisible({ timeout: 1_000 }).catch(() => false);
      if (surfacedSessionLimitMessage) {
        await expect(page.getByText(sessionLimitMessage)).toBeVisible();
      }
      await expect(getTerminalTabs(page)).toHaveCount(3, { timeout: 30_000 });
      await expect(createSessionAtLimitButton).toBeDisabled();
      await expect(createSessionAtLimitButton).toHaveAttribute(
        'title',
        sessionLimitMessage,
      );
      await expect(getTerminalTabs(page).nth(0)).toContainText('Terminal 1');
      await expect(getTerminalTabs(page).nth(1)).toContainText('Terminal 2');
      await expect(getTerminalTabs(page).nth(2)).toContainText('Terminal 3');
      await expect(terminalWorkspace).not.toContainText('Failed');

      await page.locator('[data-testid^="notebook__task-terminal-tab-"]').filter({ hasText: 'Terminal 1' }).click();
      await expect(await getActiveTerminalPanel(page)).toBeVisible({ timeout: 30_000 });
      await page.locator('[data-testid^="notebook__task-terminal-tab-"]').filter({ hasText: 'Terminal 2' }).click();
      await expect(await getActiveTerminalPanel(page)).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'switch-between-terminal-sessions');

      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-workspace-tabs.png'), fullPage: true });

      await page.getByTestId('notebook__task-header-mode-conversation').click();
      const statusStrip = page.getByTestId('notebook__task-terminal-status-strip');
      await expect(statusStrip).toBeVisible({ timeout: 30_000 });
      await expect(statusStrip).toContainText('3 terminal sessions are using this task');
      await expect(statusStrip).not.toContainText(
        'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
      );
      await expect(page.getByTestId('notebook__conversation-blocked-state')).toContainText(
        'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
      );
      await expect(page.getByTestId('notebook__conversation-blocked-state')).toContainText(
        'Open Terminal Workspace',
      );
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'End terminal sessions before starting a new agent run.',
      );
      await expectTaskDeleteButtonBlocked(page, 'End all terminal sessions before deleting this task.');
      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-conversation-blocked.png'), fullPage: true });
      await captureTerminalTrace(page, 'return-to-conversation-while-terminal-stays-active');

      const createRequestsAfterReload: string[] = [];
      const createSessionRequestMatcher = new RegExp(
        `/api/v1/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/tasks/${terminalTask.taskId}/terminal/sessions$`,
      );
      const requestListener = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && createSessionRequestMatcher.test(request.url())) {
          createRequestsAfterReload.push(request.url());
        }
      };
      page.on('request', requestListener);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 3);
      let reloadedSessions: ListedTerminalSession[] = [];
      await expect
        .poll(
          async () => {
            const sessions = await listTerminalSessionsViaApiForPolling({
              page,
              workspaceId: WORKSPACE_ID,
              projectId: terminalTask.projectId,
              taskId: terminalTask.taskId,
            });
            if (!sessions) {
              return TERMINAL_SESSION_COUNT_UNAVAILABLE;
            }
            reloadedSessions = sessions.items;
            return countTerminalRecoverySessions(sessions.items);
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toBeGreaterThan(0);
      expect(reloadedSessions.map((item) => item.id).sort()).toEqual(liveSessionIdsBeforeReload);
      const expectedReloadBlockedState = getExpectedTerminalHiddenStateCopy(
        reloadedSessions.length,
        countTerminalRecoverySessions(reloadedSessions),
      );
      const hydratedStatusStrip = page.getByTestId('notebook__task-terminal-status-strip');
      const reloadedBlockedState = page.getByTestId('notebook__conversation-blocked-state');
      await expect(hydratedStatusStrip).toBeVisible({ timeout: 30_000 });
      await expect(hydratedStatusStrip).toContainText(expectedReloadBlockedState.summary);
      await expect(hydratedStatusStrip).not.toContainText(expectedReloadBlockedState.description);
      await expect(hydratedStatusStrip).toContainText('End All Sessions');
      await expect(
        hydratedStatusStrip.getByRole('button', { name: expectedReloadBlockedState.actionLabel }),
      ).toHaveCount(0);
      await expect(reloadedBlockedState).toContainText(expectedReloadBlockedState.summary);
      await expect(reloadedBlockedState).toContainText(expectedReloadBlockedState.description);
      const reopenWorkspaceCta = reloadedBlockedState.getByRole('button', {
        name: expectedReloadBlockedState.actionLabel,
      });
      await expect(reopenWorkspaceCta).toHaveCount(1);
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'End terminal sessions before starting a new agent run.',
      );
      await expectTaskDeleteButtonBlocked(page, 'End all terminal sessions before deleting this task.');
      await captureTerminalTrace(page, 'reload-task-and-preserve-backend-session-ids');

      await expectNotebookRunBlockedByLiveTerminalSessions(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
      );
      await captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist');

      await reopenWorkspaceCta.click();
      await expect(terminalWorkspace).toBeVisible({ timeout: 30_000 });
      await expect(getTerminalTabs(page)).toHaveCount(3, { timeout: 30_000 });
      await expect
        .poll(async () => await getActiveTerminalTabId(page), {
          timeout: 30_000,
          intervals: [100, 250, 500],
        })
        .toBe('terminal-session-2');
      expect(createRequestsAfterReload).toHaveLength(0);
      await captureTerminalTrace(page, 'reopen-terminal-workspace-after-reload');
      const activeTabIdBeforeClose = await getActiveTerminalTabId(page);
      await page.getByTestId(`notebook__task-terminal-close-${activeTabIdBeforeClose}`).click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 2);
      const remainingAfterSingleClose = await listTerminalSessionsViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: terminalTask.projectId,
        taskId: terminalTask.taskId,
      });
      expect(remainingAfterSingleClose.items.map((item) => item.id).sort()).toEqual(
        [firstSessionId, thirdSessionId].sort(),
      );
      expect(remainingAfterSingleClose.items[0]?.id).not.toBe(secondSessionId);
      expect(createRequestsAfterReload).toHaveLength(0);
      page.off('request', requestListener);
      await expect(getTerminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(getTerminalTabs(page).nth(0)).toContainText('Terminal 1');
      await expect(getTerminalTabs(page).nth(1)).toContainText('Terminal 2');
      await expect(await getActiveTerminalPanel(page)).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'end-one-terminal-session-without-disrupting-others');

      await page.getByTestId('notebook__task-header-mode-conversation').click();
      await expect(statusStrip).toContainText('2 terminal sessions are using this task');
      await expectTaskDeleteButtonBlocked(page, 'End all terminal sessions before deleting this task.');
      await statusStrip.getByRole('button', { name: 'End All Sessions' }).click();
      const endAllSessionsDialog = page.getByRole('alertdialog');
      await expect(endAllSessionsDialog).toContainText('End all terminal sessions?');
      await endAllSessionsDialog.getByRole('button', { name: 'End All Sessions' }).click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 0);
      await expect(statusStrip).toHaveCount(0);
      await expect(page.getByTestId('notebook__task-header-mode-terminal')).toHaveCount(0);
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).not.toHaveAttribute(
        'placeholder',
        'End terminal sessions before starting a new agent run.',
      );
      await expectTaskDeleteButtonEnabled(page);
      await captureTerminalTrace(page, 'end-last-terminal-session-and-resume-agent-work');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
      await stopActiveRunner();
    }
  });

  test('task detail fails closed when terminal truth cannot be loaded and only unlocks after an explicit retry', async ({ page }, testInfo) => {
    test.setTimeout(360_000);

    const terminalTask = await prepareTerminalReadyTask(page);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-notebook-terminal-ux',
      storyId: NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.storyId,
      title: NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.title,
      actor: NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/notebook/tasks/${terminalTask.taskId}`,
      specFile: 'e2e/integration-notebook-terminal-ux.spec.ts',
      browser: 'chromium',
      goal: NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.goal,
      preconditions: [...(NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.preconditions ?? [])],
      seedData: [...(NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_STORY.seedData ?? [])],
      storyBinding: NOTEBOOK_TERMINAL_TRUTH_UNAVAILABLE_BINDING,
    });
    const captureTruthUnavailableTrace = async (pageRef: Page, stepId: string): Promise<void> => {
      const storyStep = resolveTruthUnavailableStep(stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    let failTerminalTruth = true;
    const terminalSessionsRoute = new RegExp(
      `/api/v1/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/tasks/${terminalTask.taskId}/terminal/sessions(?:\\?.*)?$`,
    );

    await page.route(terminalSessionsRoute, async (route) => {
      if (!failTerminalTruth) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error_code: 'TERMINAL_TRUTH_UNAVAILABLE',
          message: 'terminal_truth_unavailable_for_retry_story',
        }),
      });
    });

    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/notebook/tasks/${terminalTask.taskId}`);

      const truthUnavailableBanner = page.getByTestId('notebook__task-terminal-truth-unavailable');
      const truthUnavailableBlockedState = page.getByTestId('notebook__conversation-blocked-state');
      const retryTerminalTruthButton = truthUnavailableBlockedState.getByRole('button', { name: 'Retry terminal status check' });
      await expect(truthUnavailableBanner).toBeVisible({ timeout: 30_000 });
      await expect(truthUnavailableBanner).toContainText('Terminal session status is temporarily unavailable');
      await expect(truthUnavailableBanner).not.toContainText(
        'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      );
      await expect(truthUnavailableBanner.getByRole('button', { name: 'Retry terminal status check' })).toHaveCount(0);
      await expect(truthUnavailableBlockedState).toContainText('Terminal session status is temporarily unavailable');
      await expect(truthUnavailableBlockedState).toContainText(
        'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      );
      await expect(retryTerminalTruthButton).toHaveCount(1);
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'hidden',
        terminalModeEnabled: false,
        blocked: true,
      });
      await expect(truthUnavailableBlockedState).toContainText(
        'We could not confirm live terminal sessions for this task.',
      );
      await expectTaskDeleteButtonBlocked(
        page,
        'Terminal session status is temporarily unavailable. Retry before deleting this task.',
      );
      await captureTruthUnavailableTrace(page, 'return-to-task-while-terminal-truth-is-unavailable');
      await captureTruthUnavailableTrace(page, 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing');
      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-truth-unavailable.png'), fullPage: true });

      failTerminalTruth = false;
      await captureTruthUnavailableTrace(page, 'retry-terminal-truth-check-from-blocked-task');
      await retryTerminalTruthButton.click();

      await expect(truthUnavailableBanner).toHaveCount(0);
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await expectTaskDeleteButtonEnabled(page);
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 0);
      await captureTruthUnavailableTrace(page, 'unlock-task-after-terminal-truth-recovers');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
      await page.unroute(terminalSessionsRoute);
      await terminalTask.runner.stop();
    }
  });

  test('project member reloads into the same interrupted terminal task, reconnects the existing session, clears a broken session, and only regains agent input after recovery', async ({ page }, testInfo) => {
    test.setTimeout(600_000);

    const recoveryTask = await prepareTerminalReadyTask(page);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-notebook-terminal-ux',
      storyId: NOTEBOOK_TERMINAL_RECOVERY_STORY.storyId,
      title: NOTEBOOK_TERMINAL_RECOVERY_STORY.title,
      actor: NOTEBOOK_TERMINAL_RECOVERY_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${recoveryTask.projectId}/notebook/tasks/${recoveryTask.taskId}`,
      specFile: 'e2e/integration-notebook-terminal-ux.spec.ts',
      browser: 'chromium',
      goal: NOTEBOOK_TERMINAL_RECOVERY_STORY.goal,
      preconditions: [...(NOTEBOOK_TERMINAL_RECOVERY_STORY.preconditions ?? [])],
      seedData: [...(NOTEBOOK_TERMINAL_RECOVERY_STORY.seedData ?? [])],
      storyBinding: NOTEBOOK_TERMINAL_RECOVERY_BINDING,
    });
    const captureRecoveryTrace = async (pageRef: Page, stepId: string): Promise<void> => {
      const storyStep = resolveRecoveryStep(stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${recoveryTask.projectId}/notebook/tasks/${recoveryTask.taskId}`);
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await page.getByTestId('notebook__task-header-terminal-create').click();
      await expect(page.getByTestId('notebook__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });

      const [recoverableSessionId] = await waitForTerminalSessionIds(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        1,
      );
      expect(recoverableSessionId).toBeTruthy();
      await waitForActiveTerminalReady(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        recoverableSessionId!,
      );

      await page.getByTestId('notebook__task-header-mode-conversation').click();
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'hidden',
        terminalModeEnabled: true,
        blocked: true,
        statusStrip: 'visible',
      });
      await expect(page.getByTestId('notebook__task-terminal-status-strip')).toContainText('1 terminal session is using this task');
      await expect(page.getByTestId('notebook__conversation-blocked-state')).toContainText(
        'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
      );
      await captureRecoveryTrace(page, 'return-to-interrupted-notebook-task');

      const createRequestsDuringReconnect: string[] = [];
      const createSessionRequestMatcher = new RegExp(
        `/api/v1/workspaces/${WORKSPACE_ID}/projects/${recoveryTask.projectId}/tasks/${recoveryTask.taskId}/terminal/sessions$`,
      );
      const requestListener = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && createSessionRequestMatcher.test(request.url())) {
          createRequestsDuringReconnect.push(request.url());
        }
      };
      page.on('request', requestListener);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForTerminalSessionCount(page, WORKSPACE_ID, recoveryTask.projectId, recoveryTask.taskId, 1);
      let reloadedRecoverySessions: ListedTerminalSession[] = [];
      await expect
        .poll(
          async () => {
            const sessions = await listTerminalSessionsViaApiForPolling({
              page,
              workspaceId: WORKSPACE_ID,
              projectId: recoveryTask.projectId,
              taskId: recoveryTask.taskId,
            });
            if (!sessions) {
              return TERMINAL_SESSION_COUNT_UNAVAILABLE;
            }
            reloadedRecoverySessions = sessions.items;
            return countTerminalRecoverySessions(sessions.items);
          },
          { timeout: 30_000, intervals: [500, 1_000, 2_000] },
        )
        .toBeGreaterThan(0);
      expect(reloadedRecoverySessions.map((item) => item.id).sort()).toEqual([recoverableSessionId!]);
      await captureRecoveryTrace(page, 'lose-terminal-connection-without-ending-task');
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'hidden',
        terminalModeEnabled: true,
        blocked: true,
        statusStrip: 'visible',
      });
      const expectedRecoveryBlockedState = getExpectedTerminalHiddenStateCopy(
        reloadedRecoverySessions.length,
        countTerminalRecoverySessions(reloadedRecoverySessions),
      );
      const recoveryStatusStripAfterReload = page.getByTestId('notebook__task-terminal-status-strip');
      const recoveryBlockedStateAfterReload = page.getByTestId('notebook__conversation-blocked-state');
      await expect(recoveryStatusStripAfterReload).toContainText(expectedRecoveryBlockedState.summary);
      await expect(recoveryStatusStripAfterReload).not.toContainText(expectedRecoveryBlockedState.description);
      await expect(recoveryBlockedStateAfterReload).toContainText(expectedRecoveryBlockedState.summary);
      await expect(recoveryBlockedStateAfterReload).toContainText(expectedRecoveryBlockedState.description);
      const reopenRecoveredWorkspaceCta = recoveryBlockedStateAfterReload.getByRole('button', {
        name: expectedRecoveryBlockedState.actionLabel,
      });
      await expect(reopenRecoveredWorkspaceCta).toHaveCount(1);
      await expectNotebookRunBlockedByLiveTerminalSessions(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
      );
      await captureRecoveryTrace(page, 'keep-create-run-and-delete-fail-closed-until-terminal-truth-recovers');
      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-recovery-blocked.png'), fullPage: true });
      await captureRecoveryTrace(page, 'reload-task-and-fail-closed-on-recovery-needed-terminal');

      await reopenRecoveredWorkspaceCta.click();
      await expect(getTerminalTabs(page)).toHaveCount(1, { timeout: 30_000 });
      await expect(getTerminalTabs(page).first()).toContainText('Terminal 1');
      await expect
        .poll(async () => await getActiveTerminalTabId(page), {
          timeout: 30_000,
          intervals: [100, 250, 500],
        })
        .toBe('terminal-session-1');
      await expect(await getActiveTerminalTab(page)).toContainText('Terminal 1');
      await expect(await getActiveTerminalTab(page)).not.toContainText('Failed');
      await expect(createRequestsDuringReconnect).toHaveLength(0);
      await captureRecoveryTrace(page, 'reopen-terminal-workspace-and-reconnect-existing-session');

      await waitForActiveTerminalReady(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        recoverableSessionId!,
      );
      page.off('request', requestListener);
      await runCommandInActiveTerminalViaBrowser(page, 'printf "SESSION_RECONNECTED_OK\\n"', 'SESSION_RECONNECTED_OK');
      await captureRecoveryTrace(page, 'confirm-reconnected-terminal-is-still-usable');

      const failedSession = await createTerminalSessionViaApiWithWs({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: recoveryTask.projectId,
        taskId: recoveryTask.taskId,
        shell: '/definitely/not-a-real-shell',
      });
      const failedSessionId = failedSession.sessionId;
      await waitForTerminalSessionCount(page, WORKSPACE_ID, recoveryTask.projectId, recoveryTask.taskId, 2);
      await waitForTerminalSessionStartupFailure(failedSession.wsUrl, 'invalid_shell');
      await waitForTerminalSessionStatus(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        failedSessionId,
        'failed',
      );
      expect(
        await waitForTerminalSessionIds(
          page,
          WORKSPACE_ID,
          recoveryTask.projectId,
          recoveryTask.taskId,
          2,
        ),
      ).toEqual([failedSessionId, recoverableSessionId!].sort());
      await expect(getTerminalTabs(page)).toHaveCount(1, { timeout: 30_000 });
      await expect(getTerminalTabs(page).nth(0)).toContainText('Terminal 1');
      await expect(await getActiveTerminalTab(page)).toContainText('Terminal 1');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('notebook__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });
      await expect(getTerminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(getTerminalTabs(page).nth(0)).toContainText('Terminal 1');
      await expect(getTerminalTabs(page).nth(1)).toContainText('Terminal 2');
      await expect(getTerminalTabs(page).nth(1)).not.toContainText('Connecting');
      await waitForTerminalSessionStatus(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        failedSessionId,
        'failed',
      );
      await getTerminalTabs(page).nth(1).click();
      await expect(getTerminalTabs(page).nth(1)).toContainText(/Failed|Closed/i);
      await expect(await getActiveTerminalTab(page)).toContainText(/Failed|Closed/i);
      const brokenTerminalPanel = await getActiveTerminalPanel(page);
      await expect(brokenTerminalPanel.getByRole('button', { name: 'End Session' })).toBeVisible();
      await expect(brokenTerminalPanel).toContainText(
        'End this terminal session, then reopen it from the task header when you are ready to retry.',
      );
      await page.getByTestId('notebook__task-header-mode-conversation').click();
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'hidden',
        terminalModeEnabled: true,
        blocked: true,
        statusStrip: 'visible',
      });
      const recoveryStatusStrip = page.getByTestId('notebook__task-terminal-status-strip');
      const recoveryBlockedState = page.getByTestId('notebook__conversation-blocked-state');
      await expect(recoveryStatusStrip).toContainText('2 terminal sessions are using this task, 1 needs recovery');
      await expect(recoveryStatusStrip).not.toContainText(
        '2 terminal sessions are still using this task, and 1 of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.',
      );
      await expect(recoveryBlockedState).toContainText('2 terminal sessions are using this task, 1 needs recovery');
      await expect(recoveryBlockedState).toContainText(
        '2 terminal sessions are still using this task, and 1 of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.',
      );
      await expect(recoveryBlockedState.getByRole('button', { name: 'Reopen Terminal Workspace' })).toHaveCount(1);
      await captureRecoveryTrace(page, 'surface-broken-terminal-session-inside-same-task');

      await recoveryBlockedState.getByRole('button', { name: 'Reopen Terminal Workspace' }).click();
      const failedTabId = await getActiveTerminalTabId(page);
      await page.getByTestId(`notebook__task-terminal-close-${failedTabId}`).click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, recoveryTask.projectId, recoveryTask.taskId, 1);
      expect(
        await waitForTerminalSessionIds(
          page,
          WORKSPACE_ID,
          recoveryTask.projectId,
          recoveryTask.taskId,
          1,
        ),
      ).toEqual([recoverableSessionId!]);
      const recoveredShellSummary = page.getByTestId('notebook__task-terminal-shell-summary');
      await expect(recoveredShellSummary).toContainText('1 terminal session is using this task');
      await expect(recoveredShellSummary).not.toContainText('needs recovery');
      await captureRecoveryTrace(page, 'clear-broken-session-and-keep-task-owned');

      await page.getByTestId('notebook__task-terminal-create').click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, recoveryTask.projectId, recoveryTask.taskId, 2);
      const recoveredSessionIds = await waitForTerminalSessionIds(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        2,
      );
      const freshSessionAfterFailedRecovery = recoveredSessionIds.find((sessionId) => sessionId !== recoverableSessionId);
      expect(freshSessionAfterFailedRecovery).toBeTruthy();
      await waitForActiveTerminalReady(
        page,
        WORKSPACE_ID,
        recoveryTask.projectId,
        recoveryTask.taskId,
        freshSessionAfterFailedRecovery!,
      );
      await expect(getTerminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(getTerminalTabs(page).nth(0)).toContainText('Terminal 1');
      await expect(getTerminalTabs(page).nth(1)).toContainText('Terminal 2');
      await expect(getTerminalTabs(page).nth(1)).not.toContainText('Failed');
      await captureRecoveryTrace(page, 'start-fresh-terminal-session-after-recovery');

      await page.getByTestId('notebook__task-header-mode-conversation').click();
      const statusStrip = page.getByTestId('notebook__task-terminal-status-strip');
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'hidden',
        terminalModeEnabled: true,
        blocked: true,
        statusStrip: 'visible',
      });
      await expect(statusStrip).toContainText('2 terminal sessions are using this task');
      await expect(statusStrip).not.toContainText(
        'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
      );
      await expect(page.getByTestId('notebook__conversation-blocked-state')).toContainText(
        'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
      );
      await expectTaskDeleteButtonBlocked(page, 'End all terminal sessions before deleting this task.');
      await statusStrip.getByRole('button', { name: 'End All Sessions' }).click();
      const endRecoveredSessionsDialog = page.getByRole('alertdialog');
      await expect(endRecoveredSessionsDialog).toContainText('End all terminal sessions?');
      await endRecoveredSessionsDialog.getByRole('button', { name: 'End All Sessions' }).click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, recoveryTask.projectId, recoveryTask.taskId, 0);
      await expectNotebookTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await expectTaskDeleteButtonEnabled(page);
      await captureRecoveryTrace(page, 'end-recovered-terminal-session-and-return-to-agent-work');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
      await recoveryTask.runner.stop();
    }
  });
});
