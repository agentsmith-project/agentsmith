import { expect, test, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  BACKEND_REAL_MODEL,
  BACKEND_REAL_OPENAI_BASE_URL,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createAgentTaskViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  createTerminalSessionViaApi,
  deleteTerminalSessionViaApi,
  expectTerminalSessionRunnerEvidenceViaApi,
  keycloakLoginToWorkspace,
  listTerminalSessionsViaApi,
  waitForTerminalSessionFinalTruthViaApi,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_ID = 'ws_default';
const SPEC_FILE = 'e2e/integration-agent-task-terminal-ux.spec.ts';
const TERMINAL_MULTI_SESSION_STORY = loadStoryDefinitionSync('agent-task-terminal-workspace-multi-session');
const TERMINAL_MULTI_SESSION_BINDING = buildTraceStoryBinding(TERMINAL_MULTI_SESSION_STORY);
const TERMINAL_TRUTH_RETRY_STORY = loadStoryDefinitionSync('agent-task-terminal-truth-unavailable-retry');
const TERMINAL_TRUTH_RETRY_BINDING = buildTraceStoryBinding(TERMINAL_TRUTH_RETRY_STORY);
const TERMINAL_REENTRY_STORY = loadStoryDefinitionSync('agent-task-terminal-reentry-recovery');
const TERMINAL_REENTRY_BINDING = buildTraceStoryBinding(TERMINAL_REENTRY_STORY);
const RECOVERABLE_TERMINAL_SESSION_STATUSES = [
  'active',
  'connected',
  'disconnected',
  'pending',
  'preparing',
  'ready',
  'recovering',
  'running',
  'starting',
];
const TERMINAL_FAILED_OR_GENERIC_ERROR_TEXT =
  /\bFailed\b|Terminal unavailable|Terminal session failed|The terminal connection could not be opened|The terminal stopped and the original session cannot be reconnected|Something went wrong|Unexpected error|terminal_connection_failed|terminal_unrecoverable_generic/i;
const TERMINAL_TRANSIENT_NOT_READY_TEXT =
  /\bPreparing\b|\bConnecting\b|\bRecovering\b|\bDisconnected\b|\bClosing\b/i;

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function prepareTerminalUxTask(page: Page): Promise<{
  projectId: string;
  taskId: string;
  runnerId: string;
}> {
  const providerApiKey = requireRealLaneApiKey();
  await keycloakLoginToWorkspace(
    page,
    WORKSPACE_ID,
    KEYCLOAK_DEV_ADMIN_USERNAME,
    KEYCLOAK_DEV_ADMIN_PASSWORD,
    { ensureProjectCreatorAccess: true },
  );
  const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Agent Task Terminal UX');
  const credentialName = `Terminal UX Credential ${Date.now()}`;
  await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, providerApiKey);
  const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
    endpointName: `Terminal UX Endpoint ${Date.now()}`,
    endpointModel: BACKEND_REAL_MODEL,
    upstreamBaseUrl: BACKEND_REAL_OPENAI_BASE_URL,
    credentialName,
  });
  const runner = await createManagedAgentRunnerViaApi(page, {
    workspaceId: WORKSPACE_ID,
    projectId,
    endpointId,
    title: `agent-task-terminal-ux-runner-${Date.now()}`,
  });
  const taskId = await createAgentTaskViaApi({
    page,
    workspaceId: WORKSPACE_ID,
    projectId,
    title: `Agent Task Terminal UX ${Date.now()}`,
    workspaceName: `Agent Task Terminal UX Workspace ${Date.now()}`,
  });

  return {
    projectId,
    taskId,
    runnerId: runner.runnerId,
  };
}

async function expectSingleTerminalSessionViaApi(args: {
  page: Page;
  projectId: string;
  taskId: string;
  sessionId: string;
}): Promise<void> {
  await expect.poll(async () => {
    const listed = await listTerminalSessionsViaApi({
      page: args.page,
      workspaceId: WORKSPACE_ID,
      projectId: args.projectId,
      taskId: args.taskId,
    });
    return JSON.stringify({
      total: listed.total,
      sessionIds: listed.items
        .map((session) => session.terminal_session_id)
        .sort(),
    });
  }, {
    timeout: 60_000,
    intervals: [500, 1_000, 2_000],
  }).toBe(JSON.stringify({
    total: 1,
    sessionIds: [args.sessionId],
  }));

  const listed = await listTerminalSessionsViaApi({
    page: args.page,
    workspaceId: WORKSPACE_ID,
    projectId: args.projectId,
    taskId: args.taskId,
  });
  const session = listed.items.find(
    (item) => item.terminal_session_id === args.sessionId,
  );
  expect(session, `terminal session ${args.sessionId} should remain listed`).toBeTruthy();
  expect(RECOVERABLE_TERMINAL_SESSION_STATUSES).toContain(session?.status);
}

async function expectNoTerminalSessionsViaApi(args: {
  page: Page;
  projectId: string;
  taskId: string;
}): Promise<void> {
  await expect.poll(async () => {
    const listed = await listTerminalSessionsViaApi({
      page: args.page,
      workspaceId: WORKSPACE_ID,
      projectId: args.projectId,
      taskId: args.taskId,
    });
    return JSON.stringify({
      total: listed.total,
      sessionIds: listed.items
        .map((session) => session.terminal_session_id)
        .sort(),
    });
  }, {
    timeout: 60_000,
    intervals: [500, 1_000, 2_000],
  }).toBe(JSON.stringify({
    total: 0,
    sessionIds: [],
  }));
}

async function expectNoSecondTerminalSessionViaApi(args: {
  page: Page;
  projectId: string;
  taskId: string;
  sessionId: string;
}): Promise<void> {
  await expectSingleTerminalSessionViaApi(args);
}

function getActiveTerminalPanel(page: Page) {
  return page.locator(
    '[data-testid="agent-tasks__task-terminal"][data-visible="true"], ' +
    '[data-testid^="agent-tasks__task-terminal-terminal-session-"][data-visible="true"]',
  ).first();
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatTerminalPrintfCommand(value: string): string {
  if (value.length < 2) {
    throw new Error('terminal_io_marker_too_short');
  }
  const splitAt = Math.ceil(value.length / 2);
  const markerParts = [
    value.slice(0, splitAt),
    value.slice(splitAt),
  ];
  return `printf '${'%s'.repeat(markerParts.length)}\\n' ${markerParts
    .map(shellSingleQuote)
    .join(' ')}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function formatTerminalSessionCloseTruthForAttachment(
  truth: Awaited<ReturnType<typeof waitForTerminalSessionFinalTruthViaApi>>,
): string {
  return JSON.stringify({
    outcome: truth.outcome,
    list_total: truth.listTotal,
    get_status: truth.getStatus,
    close_state: truth.closeState,
    close_deadline_at: truth.closeDeadlineAt,
    close_attempt_id: truth.closeAttemptId,
    close_request_id: truth.closeRequestId,
    close_ack_status: truth.closeAckStatus,
    close_diagnostic_code: truth.closeDiagnosticCode,
    diagnostic_code: truth.diagnosticCode,
    last_error: truth.lastError,
  });
}

async function focusActiveTerminalInput(terminalPanel: Locator): Promise<void> {
  const terminalViewport = terminalPanel.getByTestId('agent-tasks__task-terminal-viewport');
  await terminalViewport.click();
  const xtermInput = terminalPanel.locator('textarea.xterm-helper-textarea').first();
  try {
    await xtermInput.focus({ timeout: 5_000 });
  } catch {
    await terminalViewport.click();
  }
}

async function resetActiveTerminalPrompt(page: Page): Promise<void> {
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

async function expectTerminalWorkspaceNoFailedOrGenericError(page: Page): Promise<void> {
  const terminalWorkspace = page.getByTestId('agent-tasks__task-terminal-workspace');
  await expect(terminalWorkspace).toBeVisible({ timeout: 30_000 });
  await expect(terminalWorkspace).not.toContainText(TERMINAL_FAILED_OR_GENERIC_ERROR_TEXT);
}

async function expectTerminalIoThroughPage(args: {
  page: Page;
  marker: string;
}): Promise<void> {
  await expectTerminalWorkspaceNoFailedOrGenericError(args.page);
  const terminalPanel = getActiveTerminalPanel(args.page);
  await expect(terminalPanel).toBeVisible({ timeout: 30_000 });
  await expect(terminalPanel).not.toContainText(TERMINAL_FAILED_OR_GENERIC_ERROR_TEXT);
  await expect(terminalPanel).not.toContainText(TERMINAL_TRANSIENT_NOT_READY_TEXT, {
    timeout: 60_000,
  });

  await focusActiveTerminalInput(terminalPanel);
  await resetActiveTerminalPrompt(args.page);
  await expect(terminalPanel).not.toContainText(args.marker);
  await args.page.keyboard.insertText(formatTerminalPrintfCommand(args.marker));
  await args.page.keyboard.press('Enter');
  await expect(terminalPanel).toContainText(args.marker, { timeout: 60_000 });
}

async function readRemainingTerminalSessionIds(args: {
  page: Page;
  projectId: string;
  taskId: string;
}): Promise<string[]> {
  const listed = await listTerminalSessionsViaApi({
    page: args.page,
    workspaceId: WORKSPACE_ID,
    projectId: args.projectId,
    taskId: args.taskId,
  });
  return listed.items
    .map((session) => session.terminal_session_id)
    .sort();
}

async function cleanupTerminalSessionAfterEvidence(args: {
  page: Page;
  projectId: string;
  taskId: string;
  sessionId: string;
  testInfo: TestInfo;
}): Promise<void> {
  let deleteError: unknown = null;
  try {
    await deleteTerminalSessionViaApi({
      page: args.page,
      workspaceId: WORKSPACE_ID,
      projectId: args.projectId,
      taskId: args.taskId,
      sessionId: args.sessionId,
    });
  } catch (error) {
    deleteError = error;
  }

  let closeTruthAttachment: string | null = null;
  let closeTruthError: unknown = null;
  try {
    const closeTruth = await waitForTerminalSessionFinalTruthViaApi({
      page: args.page,
      workspaceId: WORKSPACE_ID,
      projectId: args.projectId,
      taskId: args.taskId,
      sessionId: args.sessionId,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
    });
    closeTruthAttachment = formatTerminalSessionCloseTruthForAttachment(closeTruth);
  } catch (error) {
    closeTruthError = error;
  }

  let remainingSessionIds: string[] = [];
  let listWaitError: unknown = null;
  try {
    await expect.poll(async () => {
      remainingSessionIds = await readRemainingTerminalSessionIds({
        page: args.page,
        projectId: args.projectId,
        taskId: args.taskId,
      });
      return JSON.stringify(remainingSessionIds);
    }, {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000, 5_000],
    }).toBe(JSON.stringify([]));
  } catch (error) {
    listWaitError = error;
  }

  if (!listWaitError) {
    return;
  }

  const message = [
    `terminal_session_cleanup_incomplete:${args.sessionId}`,
    `remaining=${remainingSessionIds.join(',')}`,
    deleteError ? `delete_error=${formatUnknownError(deleteError)}` : null,
    closeTruthError ? `close_truth_error=${formatUnknownError(closeTruthError)}` : null,
    closeTruthAttachment ? `close_truth=${closeTruthAttachment}` : null,
    `list_wait_error=${formatUnknownError(listWaitError)}`,
  ].filter(Boolean).join(':');
  await args.testInfo.attach('terminal-session-cleanup-failure', {
    body: message,
    contentType: 'text/plain',
  });
  throw new Error(message);
}

async function failBrowserTerminalSessionTruth(args: {
  page: Page;
  projectId: string;
  taskId: string;
}): Promise<() => Promise<void>> {
  const routePattern = `**/api/v1/workspaces/${WORKSPACE_ID}/projects/${args.projectId}/tasks/${args.taskId}/terminal/sessions`;
  let failBrowserTruth = true;
  const handler = async (route: Route) => {
    if (!failBrowserTruth) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error_code: 'terminal_truth_temporarily_unavailable',
        message: 'terminal truth temporarily unavailable',
      }),
    });
  };
  await args.page.route(routePattern, handler);
  return async () => {
    failBrowserTruth = false;
    await args.page.unroute(routePattern, handler);
  };
}

test.describe('@lane-real Agent Task terminal workspace UX', () => {
  test('shows an active Agent Task terminal session without wrapping legacy coverage', async ({ page }, testInfo) => {
    test.setTimeout(720_000);
    const prepared = await prepareTerminalUxTask(page);
    const multiSessionTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_MULTI_SESSION_STORY.storyId,
      title: TERMINAL_MULTI_SESSION_STORY.title,
      actor: TERMINAL_MULTI_SESSION_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_MULTI_SESSION_STORY.goal,
      preconditions: [...(TERMINAL_MULTI_SESSION_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_MULTI_SESSION_STORY.seedData ?? [])],
      storyBinding: TERMINAL_MULTI_SESSION_BINDING,
    });
    const truthRetryTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_TRUTH_RETRY_STORY.storyId,
      title: TERMINAL_TRUTH_RETRY_STORY.title,
      actor: TERMINAL_TRUTH_RETRY_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_TRUTH_RETRY_STORY.goal,
      preconditions: [...(TERMINAL_TRUTH_RETRY_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_TRUTH_RETRY_STORY.seedData ?? [])],
      storyBinding: TERMINAL_TRUTH_RETRY_BINDING,
    });
    const reentryTrace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-task-terminal-ux',
      storyId: TERMINAL_REENTRY_STORY.storyId,
      title: TERMINAL_REENTRY_STORY.title,
      actor: TERMINAL_REENTRY_STORY.actor,
      route: `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`,
      specFile: SPEC_FILE,
      browser: 'chromium',
      goal: TERMINAL_REENTRY_STORY.goal,
      preconditions: [...(TERMINAL_REENTRY_STORY.preconditions ?? [])],
      seedData: [...(TERMINAL_REENTRY_STORY.seedData ?? [])],
      storyBinding: TERMINAL_REENTRY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';
    let activeTerminalSessionId: string | null = null;
    let restoreBrowserTerminalTruth: (() => Promise<void>) | null = null;
    let primaryFailure: unknown = null;
    let traceFinishFailure: unknown = null;
    let cleanupFailure: unknown = null;

    try {
      const taskRoute = `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks/${prepared.taskId}`;
      const taskListRoute = `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${prepared.projectId}/agent-tasks`;
      const truthUnavailableSession = await createTerminalSessionViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        shell: '/usr/bin/bash',
      });
      activeTerminalSessionId = truthUnavailableSession.sessionId;
      await expectTerminalSessionRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: truthUnavailableSession.sessionId,
        runnerId: prepared.runnerId,
        createdSession: truthUnavailableSession,
      });
      await expectSingleTerminalSessionViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: truthUnavailableSession.sessionId,
      });

      restoreBrowserTerminalTruth = await failBrowserTerminalSessionTruth({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
      });
      await page.goto(taskRoute);
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toBeVisible({
        timeout: 30_000,
      });
      await truthRetryTrace.capture(page, {
        stepId: 'return-to-task-while-terminal-truth-is-unavailable',
        action: 'Return to the task while terminal session truth is temporarily unavailable',
        target: 'agent-tasks__task-terminal-truth-unavailable',
        note: 'Terminal truth is unavailable and the task fails closed.',
      });
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toBeVisible({
        timeout: 30_000,
      });
      await truthRetryTrace.capture(page, {
        stepId: 'keep-run-and-delete-fail-closed-while-terminal-truth-is-missing',
        action: 'Stay in the blocked task while run and delete remain fail-closed',
        target: 'agent-tasks__conversation-blocked-state',
        note: 'Conversation remains blocked until terminal truth can be retried.',
      });
      await truthRetryTrace.capture(page, {
        stepId: 'retry-terminal-truth-check-from-blocked-task',
        action: 'Retry terminal status check from the blocked task',
        target: 'agent-tasks__conversation-blocked-state',
        note: 'The retry control is available inside the blocked task surface.',
      });
      await deleteTerminalSessionViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: truthUnavailableSession.sessionId,
      });
      await expectNoTerminalSessionsViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
      });
      activeTerminalSessionId = null;
      await restoreBrowserTerminalTruth();
      restoreBrowserTerminalTruth = null;
      await page.getByTestId('agent-tasks__conversation-blocked-action').click();
      await expect(page.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toHaveCount(0);
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0);
      await expect(page.getByTestId('agent-task__task-header-actions')).toBeVisible({ timeout: 30_000 });
      await truthRetryTrace.capture(page, {
        stepId: 'unlock-task-after-terminal-truth-recovers',
        action: 'Continue the same task after backend terminal truth recovers',
        target: 'agent-task__task-header-actions',
        note: 'The task unlocks after retry confirms no live terminal sessions remain.',
      });

      const terminalSession = await createTerminalSessionViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        shell: '/usr/bin/bash',
      });
      activeTerminalSessionId = terminalSession.sessionId;
      await expectTerminalSessionRunnerEvidenceViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
        runnerId: prepared.runnerId,
        createdSession: terminalSession,
      });
      await expectSingleTerminalSessionViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
      });

      await page.goto(taskRoute);
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
      await reentryTrace.capture(page, {
        stepId: 'return-to-interrupted-agent-task',
        action: 'Return to the interrupted Agent Task',
        target: 'agent-task__task-header',
        note: 'Canonical Agent Task terminal re-entry route is active.',
      });
      await expect(page.getByTestId('agent-task__task-header-terminal-summary')).toContainText('1 terminal session', {
        timeout: 60_000,
      });
      await expect(page.getByTestId('agent-tasks__task-terminal-status-strip')).toContainText('1 terminal session');
      const conversationBlocker = page.getByTestId('agent-tasks__conversation-blocked-state');
      await expect(conversationBlocker).toBeVisible({ timeout: 30_000 });
      await expect(conversationBlocker).toContainText('1 terminal session');
      const openTerminalWorkspaceAction = page.getByTestId('agent-tasks__conversation-blocked-action');
      await expect(openTerminalWorkspaceAction).toBeVisible();
      await expect(openTerminalWorkspaceAction).toContainText('Open Terminal Workspace');
      await multiSessionTrace.capture(page, {
        stepId: 'return-to-agent-task',
        action: 'Return to Agent Task with a live terminal session',
        target: 'agent-tasks__conversation-blocked-state',
        note: 'Conversation shows the live terminal blocker before reopening Terminal workspace.',
      });

      await openTerminalWorkspaceAction.click();
      await expect(page.getByTestId('agent-tasks__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-tasks__task-terminal-create')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0);
      await multiSessionTrace.capture(page, {
        stepId: 'open-terminal-workspace',
        action: 'Open terminal workspace',
        target: 'agent-tasks__task-terminal-workspace',
        note: 'Terminal workspace opens under the canonical Agent Task route.',
      });
      await expectNoSecondTerminalSessionViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-task__task-header-terminal-summary')).toContainText('1 terminal session', {
        timeout: 60_000,
      });
      await page.getByTestId('agent-task__task-header-mode-terminal').click();
      await expect(page.getByTestId('agent-tasks__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });
      await expectTerminalWorkspaceNoFailedOrGenericError(page);
      await expectNoSecondTerminalSessionViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
      });
      await reentryTrace.capture(page, {
        stepId: 'reload-agent-task-terminal-workspace',
        action: 'Reload the Agent Task route',
        target: 'agent-tasks__task-terminal-workspace',
        note: 'The same terminal session is recovered after a browser reload.',
      });

      await page.goto(taskListRoute);
      await page.goto(taskRoute);
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('agent-task__task-header-mode-terminal').click();
      await expect(page.getByTestId('agent-tasks__task-terminal-workspace')).toBeVisible({ timeout: 30_000 });
      await expectTerminalWorkspaceNoFailedOrGenericError(page);
      await expectNoSecondTerminalSessionViaApi({
        page,
        projectId: prepared.projectId,
        taskId: prepared.taskId,
        sessionId: terminalSession.sessionId,
      });
      await expectTerminalIoThroughPage({
        page,
        marker: `AGENTSMITH_REENTER_IO_${Date.now()}`,
      });
      await reentryTrace.capture(page, {
        stepId: 're-enter-agent-task-terminal-workspace',
        action: 'Navigate away and re-enter the Agent Task terminal workspace',
        target: 'agent-tasks__task-terminal-workspace',
        note: 'The terminal workspace re-enters the existing session, shows no failed/generic terminal error, and returns a page-level terminal IO probe.',
      });
      outcome = 'pass';
    } catch (error) {
      primaryFailure = error;
    } finally {
      try {
        await Promise.all([
          multiSessionTrace.finish({ outcome }),
          truthRetryTrace.finish({ outcome }),
          reentryTrace.finish({ outcome }),
        ]);
      } catch (error) {
        traceFinishFailure = error;
      }

      if (restoreBrowserTerminalTruth) {
        try {
          await restoreBrowserTerminalTruth();
          restoreBrowserTerminalTruth = null;
        } catch (error) {
          cleanupFailure = error;
          await testInfo.attach('terminal-truth-route-restore-failure', {
            body: formatUnknownError(error),
            contentType: 'text/plain',
          });
        }
      }

      if (activeTerminalSessionId) {
        try {
          await cleanupTerminalSessionAfterEvidence({
            page,
            projectId: prepared.projectId,
            taskId: prepared.taskId,
            sessionId: activeTerminalSessionId,
            testInfo,
          });
          activeTerminalSessionId = null;
        } catch (error) {
          cleanupFailure = error;
          await testInfo.attach('terminal-session-cleanup-failure', {
            body: formatUnknownError(error),
            contentType: 'text/plain',
          });
        }
      }
    }

    if (primaryFailure) throw primaryFailure;
    if (traceFinishFailure) throw traceFinishFailure;
    if (cleanupFailure) throw cleanupFailure;
  });
});
