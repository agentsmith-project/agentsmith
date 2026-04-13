import { expect, test, type Locator, type Page } from '@playwright/test';
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
  createProjectInWorkspace,
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

function resolveTerminalStep(stepId: string) {
  const step = NOTEBOOK_TERMINAL_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_notebook_terminal_step:${stepId}`);
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
        const sessions = await listTerminalSessionsViaApi({
          page,
          workspaceId,
          projectId,
          taskId,
        });
        return sessions.total;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(expected);
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
      },
    },
  );

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  return payload.id ?? payload.session_id;
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
        const sessions = await listTerminalSessionsViaApi({
          page,
          workspaceId,
          projectId,
          taskId,
        });
        return sessions.items.find((item) => item.id === sessionId)?.status ?? null;
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

test.describe.serial('@lane-real notebook terminal workspace UX walkthrough', () => {
  test('project member switches between terminal workspace sessions and only regains agent input after the last session ends', async ({ page }, testInfo) => {
    test.setTimeout(480_000);

    const terminalTask = await prepareTerminalReadyTask(page);
    let activeRunner = terminalTask.runner;
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

      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
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
      await page.getByTestId('notebook__task-terminal-create').click();
      await expect(getTerminalTabs(page)).toHaveCount(3, { timeout: 30_000 });
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
      await expect(statusStrip).toContainText('3 terminal sessions active');
      await expect(statusStrip).toContainText('End the terminal session before starting a new agent run.');
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'End Terminal Session before starting a new agent run...',
      );
      await captureTerminalTrace(page, 'return-to-conversation-while-terminal-stays-active');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 3);
      const hydratedStatusStrip = page.getByTestId('notebook__task-terminal-status-strip');
      await expect(hydratedStatusStrip).toBeVisible({ timeout: 30_000 });
      await expect(hydratedStatusStrip).toContainText('3 terminal sessions active');
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'End Terminal Session before starting a new agent run...',
      );
      await captureTerminalTrace(page, 'reload-task-and-restore-terminal-truth');

      await expectNotebookRunBlockedByLiveTerminalSessions(
        page,
        WORKSPACE_ID,
        terminalTask.projectId,
        terminalTask.taskId,
      );
      await captureTerminalTrace(page, 'reject-new-run-while-live-terminal-sessions-exist');

      await hydratedStatusStrip.getByRole('button', { name: 'Open Terminal Workspace' }).click();
      await expect(terminalWorkspace).toBeVisible({ timeout: 30_000 });
      await expect(getTerminalTabs(page)).toHaveCount(3, { timeout: 30_000 });
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
      await expect(getTerminalTabs(page)).toHaveCount(2, { timeout: 30_000 });
      await expect(await getActiveTerminalPanel(page)).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'end-one-terminal-session-without-disrupting-others');

      await page.getByTestId('notebook__task-header-mode-conversation').click();
      await expect(statusStrip).toContainText('2 terminal sessions active');
      await statusStrip.getByRole('button', { name: 'End All Sessions' }).click();
      await waitForTerminalSessionCount(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.taskId, 0);
      await expect(statusStrip).toHaveCount(0);
      await expect(page.getByTestId('notebook__task-header-mode-terminal')).toBeDisabled();
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).not.toHaveAttribute(
        'placeholder',
        'End Terminal Session before starting a new agent run...',
      );
      await captureTerminalTrace(page, 'end-last-terminal-session-and-resume-agent-work');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
      await stopActiveRunner();
    }
  });
});
