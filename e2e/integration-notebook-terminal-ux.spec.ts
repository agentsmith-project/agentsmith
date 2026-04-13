import { expect, test, type Page } from '@playwright/test';
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
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID ?? 'ws_default';
const TERMINAL_SESSION_ROUTE = new RegExp(`${API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/v1/workspaces/.+/projects/.+/tasks/.+/terminal/sessions$`);
const NOTEBOOK_TERMINAL_STORY = loadStoryDefinitionSync('notebook-terminal-day-to-day-and-recovery');
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
  const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Story Notebook Terminal Day 2');
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
    title: 'story-notebook-terminal-day-two',
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

async function waitForTerminalReady(panel: ReturnType<Page['getByTestId']>) {
  await expect
    .poll(async () => (await panel.textContent()) ?? '', {
      timeout: 120_000,
      intervals: [500, 1_000, 2_000],
    })
    .toContain('Terminal ready for');
}

test.describe.serial('@lane-real notebook terminal UX walkthrough', () => {
  test('project member continues notebook work through terminal warmup and recovery guidance', async ({ page }, testInfo) => {
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
    const restartRunner = async () => {
      const restartedRunner = await startCodexRunnerProcess({
        wsUrl: terminalTask.runnerBundle.wsUrl,
        agentKey: terminalTask.runnerBundle.agentKey,
      });
      activeRunner = restartedRunner;
      runnerStopped = false;
      test.info().annotations.push({ type: 'codex_runner_log', description: restartedRunner.logPath });
      await waitForAgentPresenceOnline(page, WORKSPACE_ID, terminalTask.projectId, terminalTask.agentId);
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

    let warmupIntercepted = 0;
    let outcome: 'pass' | 'fail' = 'fail';

    await page.route(TERMINAL_SESSION_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      if (warmupIntercepted < 2) {
        warmupIntercepted += 1;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error_code: 'RESOURCE_CONFLICT',
            message: 'task_runner_offline',
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${terminalTask.projectId}/notebook/tasks/${terminalTask.taskId}`);

      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'return-to-notebook-task');

      const terminalToggle = page.getByTestId('notebook__task-header-terminal');
      await expect(terminalToggle).toBeVisible();
      await expect(terminalToggle).toBeEnabled();
      await terminalToggle.click();

      const panel = page.getByTestId('notebook__task-terminal');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'open-terminal-for-follow-up-work');

      await expect
        .poll(async () => (await panel.textContent()) ?? '', { timeout: 10_000 })
        .toMatch(/Preparing|Connecting/);
      await captureTerminalTrace(page, 'stay-oriented-during-runner-warmup');

      await waitForTerminalReady(panel);
      await expect(terminalToggle).toContainText('Hide Terminal');
      await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
        'placeholder',
        'End Terminal Session before starting a new agent run...',
      );
      await expect(panel.locator('.xterm-screen')).toBeVisible({ timeout: 30_000 });
      await terminalToggle.click();
      await expect(panel).toHaveCount(0, { timeout: 30_000 });
      const hiddenNotice = page.getByTestId('notebook__task-terminal-notice');
      await expect(hiddenNotice).toBeVisible({ timeout: 30_000 });
      await expect(hiddenNotice).toContainText('Terminal session still active');
      await expect(hiddenNotice).toContainText(
        'The terminal is hidden, but it still blocks new agent runs until you show it again or end the session.',
      );
      await captureTerminalTrace(page, 'hide-terminal-without-ending-session');

      await hiddenNotice.getByRole('button', { name: 'Show Terminal' }).click();
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.locator('.xterm-screen')).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'show-hidden-terminal-session');

      await page.getByTestId('notebook__task-header-terminal-close').click();
      await expect(panel).toHaveCount(0, { timeout: 30_000 });
      await expect(terminalToggle).toHaveText('Open Terminal', { timeout: 30_000 });
      await captureTerminalTrace(page, 'end-terminal-session-before-new-run');

      await stopActiveRunner();
      await page.reload();
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
      await captureTerminalTrace(page, 'return-to-notebook-task');

      await page.getByTestId('notebook__task-header-terminal').click();

      const failedPanel = page.getByTestId('notebook__task-terminal');
      await expect(failedPanel).toBeVisible({ timeout: 30_000 });
      await expect(failedPanel).toContainText('Failed', { timeout: 30_000 });
      await expect(failedPanel).toContainText("This task's runner is not available right now.");
      await expect(failedPanel).toContainText(
        'End this terminal session, then reopen it from the task header when you are ready to retry.',
      );
      await page.screenshot({ path: testInfo.outputPath('notebook-terminal-recovery-guidance.png'), fullPage: true });
      await captureTerminalTrace(page, 'see-clear-terminal-recovery-guidance');

      await failedPanel.getByRole('button', { name: 'End Session' }).click();
      await expect(failedPanel).toHaveCount(0, { timeout: 30_000 });

      await restartRunner();
      await expect(terminalToggle).toHaveText('Open Terminal', { timeout: 30_000 });
      await terminalToggle.click();
      const recoveredPanel = page.getByTestId('notebook__task-terminal');
      await expect(recoveredPanel).toBeVisible({ timeout: 30_000 });
      await waitForTerminalReady(recoveredPanel);
      await expect(recoveredPanel).not.toContainText('Failed');
      await captureTerminalTrace(page, 'recover-terminal-after-guidance');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
      await stopActiveRunner();
    }
  });
});
