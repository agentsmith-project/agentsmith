/**
 * Agent Tasks Page E2E Tests
 *
 * Tests the agent task list, create task dialog,
 * navigation to task detail, and task detail page elements.
 */

import type { Page } from '@playwright/test';
import { test, expect, goToProject } from './fixtures/test-base';

const REALTIME_TEST_TASK_ID = 'task_002';
const CANCEL_ESCALATION_TEST_TASK_ID = 'task_002';
type TaskCancelEscalationMode = 'supported' | 'unsupported';
type TaskCancelMode = 'cancel' | 'terminate';
type TaskCancelResponsePayload = {
  status?: string;
  task_id?: string;
  run_id?: string | null;
  request_id?: string | null;
  mode?: string;
  can_escalate?: boolean;
  escalation_reason?: string | null;
  error_code?: string;
  message?: string;
};

async function setMockTaskRealtimeMode(page: Page, mode: 'sse_ticket_upstream') {
  await page.addInitScript((mockMode) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const resolvedUrl = request?.url ?? String(input);
      const url = new URL(resolvedUrl, window.location.origin);
      if (url.pathname === '/api/v1/sse-ticket') {
        url.searchParams.set('mock_task_realtime', mockMode);
        if (request) {
          return originalFetch(new Request(url.toString(), request), init);
        }
        return originalFetch(url.toString(), init);
      }
      return originalFetch(input, init);
    };
  }, mode);
}

async function setMockTaskCancelEscalationMode(page: Page, mode: TaskCancelEscalationMode) {
  await page.addInitScript(({ mockMode, taskId }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const resolvedUrl = request?.url ?? String(input);
      const url = new URL(resolvedUrl, window.location.origin);
      if (url.pathname.includes(`/api/v1/workspaces/`) && url.pathname.includes(`/tasks/${taskId}`)) {
        url.searchParams.set('mock_task_cancel_escalation', mockMode);
        if (request) {
          return originalFetch(new Request(url.toString(), request), init);
        }
        return originalFetch(url.toString(), init);
      }
      return originalFetch(input, init);
    };
  }, { mockMode: mode, taskId: CANCEL_ESCALATION_TEST_TASK_ID });
}

function agentTaskActiveRunFooter(page: Page) {
  return page.getByTestId('agent-tasks__message-active-run-footer').first();
}

function agentTaskConversationTextarea(page: Page) {
  return page
    .getByTestId('agent-tasks__conversation-input')
    .locator('textarea, input[type="text"], [contenteditable="true"]')
    .first();
}

function agentTaskEscalationDialog(page: Page) {
  return page
    .getByTestId('agent-tasks__cancel-escalation-dialog')
    .or(page.getByRole('alertdialog').filter({ hasText: /terminate|force stop|escalat|run_escalation|强制|结束/i }))
    .or(page.getByRole('dialog').filter({ hasText: /terminate|force stop|escalat|run_escalation|强制|结束/i }))
    .first();
}

function waitForAgentTaskCancelEscalationRefetch(page: Page, mode: TaskCancelEscalationMode = 'supported') {
  return page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'GET') return false;
    const url = new URL(response.url());
    return url.pathname.includes('/api/v1/workspaces/')
      && url.pathname.endsWith(`/tasks/${CANCEL_ESCALATION_TEST_TASK_ID}`)
      && url.searchParams.get('mock_task_cancel_escalation') === mode;
  }, { timeout: 30_000 });
}

function parseRequestBodyJson(request: import('@playwright/test').Request): Record<string, unknown> {
  const body = request.postData();
  expect(body, `expected request body for ${request.url()}`).toBeTruthy();
  const parsed = JSON.parse(body ?? '{}') as unknown;
  expect(parsed, `expected JSON object body for ${request.url()}`).toEqual(expect.any(Object));
  expect(Array.isArray(parsed), `expected non-array JSON object body for ${request.url()}`).toBe(false);
  return parsed as Record<string, unknown>;
}

function isAgentTaskCancelRequest(request: import('@playwright/test').Request, taskId = CANCEL_ESCALATION_TEST_TASK_ID) {
  return request.method() === 'POST'
    && new RegExp(`/api/v1/workspaces/.*/projects/.*/tasks/${taskId}/cancel`).test(request.url());
}

function isAgentTaskCancelRequestMode(
  request: import('@playwright/test').Request,
  mode: TaskCancelMode,
  taskId = CANCEL_ESCALATION_TEST_TASK_ID,
) {
  const body = request.postData() ?? '';
  return isAgentTaskCancelRequest(request, taskId)
    && new RegExp(`"mode"\\s*:\\s*"${mode}"`).test(body);
}

function expectCancelRequestMode(request: import('@playwright/test').Request, mode: TaskCancelMode) {
  const payload = parseRequestBodyJson(request);
  expect(payload.mode).toBe(mode);
  expect(payload).not.toHaveProperty('stop_mode');
}

function waitForAgentTaskCancelResponse(
  page: Page,
  mode: TaskCancelMode,
  taskId = CANCEL_ESCALATION_TEST_TASK_ID,
) {
  return page.waitForResponse((response) =>
    isAgentTaskCancelRequestMode(response.request(), mode, taskId), { timeout: 30_000 });
}

async function expectAgentTaskCancelAcceptedResponse(
  response: import('@playwright/test').Response,
  options: {
    status: 'cancelling' | 'terminating';
    stopMode: TaskCancelMode;
    canEscalate: boolean;
    escalationReason?: string | null;
  },
) {
  expect(response.status()).toBe(202);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as TaskCancelResponsePayload;
  expect(payload.status).toBe(options.status);
  expect(payload.mode).toBe(options.stopMode);
  expect(payload.can_escalate).toBe(options.canEscalate);
  if ('escalationReason' in options) {
    expect(payload.escalation_reason ?? null).toBe(options.escalationReason ?? null);
  } else {
    expect(payload.escalation_reason).toBeUndefined();
  }
  return payload;
}

async function createMockRunningAgentTask(page: Page, title: string) {
  return page.evaluate(async (taskTitle) => {
    const response = await fetch('/api/v1/workspaces/ws_001/projects/proj_001/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        workspace_mode: 'create_new',
        run_state: 'running',
      }),
    });
    if (!response.ok) {
      throw new Error(`mock_task_create_failed:${response.status}`);
    }
    const payload = await response.json() as { id?: string };
    if (!payload.id) {
      throw new Error('mock_task_create_missing_id');
    }
    return payload.id;
  }, title);
}

async function fetchAgentTaskCancelContract(
  page: Page,
  args: {
    taskId: string;
    mode: TaskCancelMode;
    escalationMode: TaskCancelEscalationMode;
  },
) {
  return page.evaluate(async ({ taskId, mode, escalationMode }) => {
    const response = await fetch(
      `/api/v1/workspaces/ws_001/projects/proj_001/tasks/${taskId}/cancel?mock_task_cancel_escalation=${escalationMode}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      },
    );
    return {
      status: response.status,
      payload: await response.json() as TaskCancelResponsePayload,
    };
  }, args);
}

async function openAgentTaskEscalationDialog(page: Page) {
  const dialog = agentTaskEscalationDialog(page);
  const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (dialogVisible) return dialog;

  const escalationTrigger = page
    .getByTestId('agent-tasks__cancel-escalation-trigger')
    .or(page.getByRole('button', { name: /terminate|force stop|escalat|upgrade|run_escalation|强制|结束/i }))
    .first();
  await expect(escalationTrigger).toBeVisible({ timeout: 10000 });
  await escalationTrigger.click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe('Agent Tasks Page', () => {
  test.describe('Task List', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'agent-tasks');
    });

    test('should display task list with task cards', async ({ authedPage }) => {
      const taskList = authedPage.getByTestId('agent-tasks__task-list');
      await expect(taskList).toBeVisible({ timeout: 10000 });

      // MSW should provide at least one task card
      const taskCards = authedPage.getByTestId('agent-tasks__task-card');
      await expect(taskCards.first()).toBeVisible({ timeout: 10000 });

      // Each task card should have a data-task-id attribute
      const firstTaskId = await taskCards.first().getAttribute('data-task-id');
      expect(firstTaskId).toBeTruthy();
    });

    test('should display create task button', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('agent-tasks__create-task-btn');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await expect(createBtn).toBeEnabled();
    });

    test('should rely on sidebar navigation instead of build header actions', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('agent-tasks__open-chat')).toHaveCount(0);
      await expect(authedPage.getByTestId('agent-tasks__open-files')).toHaveCount(0);
      await expect(authedPage.getByTestId('agent-tasks__open-agent-runners')).toHaveCount(0);
      await expect(authedPage.getByTestId('sidebar__nav-item--chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--agent-runners')).toHaveAttribute('href', /\/agent-runners$/);
    });

    test('should open create task dialog', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('agent-tasks__create-task-btn');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await createBtn.click();

      // Dialog should appear
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Dialog contains a title input (id="task-title", label "Task Title")
      const titleInput = dialog.locator('#task-title');
      await expect(titleInput).toBeVisible();
      await titleInput.fill('Test Task');
      await expect(
        dialog.getByRole('radio', { name: /initialize a new task workspace automatically/i }),
      ).toBeChecked();
      await expect(dialog.locator('#task-workspace-name')).toBeVisible();
      await expect(
        dialog.getByRole('radio', { name: /continue an existing task workspace/i }),
      ).toBeVisible();

      // Close dialog
      await authedPage.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('should navigate to task detail on card click', async ({ authedPage }) => {
      const taskCards = authedPage.getByTestId('agent-tasks__task-card');
      await expect(taskCards.first()).toBeVisible({ timeout: 10000 });

      // Get the task ID from the card for URL verification
      const _taskId = await taskCards.first().getAttribute('data-task-id');

      // Click the first task card
      await taskCards.first().click();

      // Should navigate to the task detail page
      await authedPage.waitForURL(/\/agent-tasks\//, { timeout: 10000 });

      // Task header should be visible on detail page
      const taskHeader = authedPage.getByTestId('agent-task__task-header');
      const headerVisible = await taskHeader.waitFor({ state: 'visible', timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      if (!headerVisible && await authedPage.getByText(/Loading chunk .* failed/i).isVisible().catch(() => false)) {
        await authedPage.reload({ waitUntil: 'domcontentloaded' });
      }
      await expect(taskHeader).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Task Detail', () => {
    test.beforeEach(async ({ authedPage }) => {
      // Navigate directly to a known task detail page
      await goToProject(authedPage, 'agent-tasks/task_001');
    });

    test('should display task header', async ({ authedPage }) => {
      const header = authedPage.getByTestId('agent-task__task-header');
      await expect(header).toBeVisible({ timeout: 10000 });
      await expect(authedPage.getByTestId('agent-task__task-header-workspace-library')).toBeVisible();
      await expect(authedPage.getByTestId('agent-task__task-header-meta')).toContainText(/runner/i);
      await expect(authedPage.getByTestId('agent-task__open-list')).toHaveCount(0);
      await expect(authedPage.getByTestId('agent-task__open-chat')).toHaveCount(0);
      await expect(authedPage.getByTestId('agent-task__open-files')).toHaveCount(0);
      await expect(authedPage.getByTestId('sidebar__nav-item--agent-tasks')).toHaveAttribute('href', /\/agent-tasks$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
    });

    test('should expose diagnostics links from realtime status when status is visible', async ({ authedPage }) => {
      const auditLink = authedPage.getByTestId('agent-tasks__sse-status-open-audit');
      if (!(await auditLink.isVisible().catch(() => false))) {
        test.skip(true, 'Current MSW agent task lane does not surface realtime status by default.');
      }

      await expect(auditLink).toHaveAttribute('href', /\/audit(\?|$)/);
    });

    test('should display conversation input and send button', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('agent-tasks__conversation-input');
      const sendBtn = authedPage.getByTestId('agent-tasks__send-btn');

      await expect(conversationInput).toBeVisible({ timeout: 10000 });
      await expect(sendBtn).toBeVisible();
    });

    test('should display artifact cards if available', async ({ authedPage }) => {
      // Artifacts may or may not be present depending on MSW data
      const artifactCards = authedPage.getByTestId('agent-tasks__artifact-card');
      const count = await artifactCards.count();

      if (count > 0) {
        await expect(artifactCards.first()).toBeVisible();
        const artifactId = await artifactCards.first().getAttribute('data-artifact-id');
        expect(artifactId).toBeTruthy();
      }
    });

    test('should allow typing in conversation input', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('agent-tasks__conversation-input');
      await expect(conversationInput).toBeVisible({ timeout: 10000 });

      const input = conversationInput.locator(
        'textarea, input[type="text"], [contenteditable="true"]',
      );
      await expect(input.first()).toBeVisible();

      await input.first().fill('Test task prompt');

      const sendBtn = authedPage.getByTestId('agent-tasks__send-btn');
      await expect(sendBtn).toBeEnabled();
    });

    test('should open edit dialog and submit update payload', async ({ authedPage }) => {
      const patchRequestPromise = authedPage.waitForRequest((req) => {
        return req.method() === 'PATCH'
          && /\/api\/v1\/workspaces\/.*\/projects\/.*\/tasks\/task_001$/.test(req.url());
      });

      await authedPage.getByRole('button', { name: /edit/i }).click();
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();

      const titleInput = dialog.getByTestId('agent-tasks__edit-task-title');
      await titleInput.fill('Updated Task From E2E');
      await dialog.getByTestId('agent-tasks__edit-task-save').click();

      const request = await patchRequestPromise;
      const payload = request.postDataJSON() as { title?: string };
      expect(payload.title).toBe('Updated Task From E2E');
    });

    test('should navigate back to list when clicking leave button', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /leave/i }).click();
      await authedPage.waitForURL(/\/agent-tasks$/);
      await expect(authedPage.getByTestId('agent-tasks__task-list')).toBeVisible();
    });

    test('should remove deleted task from list immediately after returning from detail', async ({ authedPage }) => {
      const deletedTaskTitle = 'Product Documentation Analysis';

      await expect(authedPage.getByRole('heading', { name: deletedTaskTitle })).toBeVisible();

      await authedPage.getByRole('button', { name: /delete task|^delete$/i }).click();

      const dialog = authedPage.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /delete task|^delete$/i }).click();

      await authedPage.waitForURL(/\/agent-tasks$/);
      await expect(authedPage.getByTestId('agent-tasks__task-list')).toBeVisible();
      await expect(authedPage.getByText(deletedTaskTitle)).not.toBeVisible();
    });

    test('should navigate to files page from sidebar on task detail', async ({ authedPage }) => {
      await authedPage.getByTestId('sidebar__nav-item--files').click();
      await authedPage.waitForURL(/\/files$/, { timeout: 10000 });
      await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
      await expect(authedPage.getByTestId('files__library-list')).toBeVisible();
      await expect(authedPage.getByTestId('files__objects-table')).toBeVisible();
    });

    test('should expand execution details panel for agent messages', async ({ authedPage }) => {
      const processToggle = authedPage.getByTestId('agent-tasks__message-process-details-toggle').first();
      if (!(await processToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip(true, 'Current MSW agent task lane does not prehydrate execution details by default.');
      }
      await expect(processToggle).toBeVisible({ timeout: 10000 });
      await processToggle.click();
      await expect(authedPage.getByTestId('agent-tasks__message-process-panel')).toBeVisible();
      await expect(
        authedPage.getByTestId('agent-tasks__message-process-empty').or(
          authedPage.getByTestId('agent-tasks__message-process-steps').first(),
        ),
      ).toBeVisible();
    });
  });

  test.describe.serial('Realtime Reconciliation', () => {
    test('should keep an active hook-level connection error visible after cancel reconcile succeeds', async ({ authedPage }) => {
      await setMockTaskRealtimeMode(authedPage, 'sse_ticket_upstream');

      await goToProject(authedPage, `agent-tasks/${REALTIME_TEST_TASK_ID}`);
      await expect(authedPage.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 10000 });
      const cancelButton = authedPage.getByTestId('agent-tasks__message-active-run-cancel').first();
      await expect(cancelButton).toBeVisible();

      const realtimeStatus = authedPage.getByTestId('agent-tasks__sse-status');
      await expect(realtimeStatus).toContainText('Realtime ticket exchange failed');

      await cancelButton.click();

      await expect(cancelButton).toBeDisabled();
      await expect(cancelButton).toContainText(/cancelling/i);
      await expect(realtimeStatus).toContainText('Realtime ticket exchange failed');
      await expect(agentTaskConversationTextarea(authedPage)).toBeDisabled();
    });

    test('should escalate a stuck agent task cancel to terminate and keep sending blocked after refetch', async ({ authedPage }) => {
      await setMockTaskCancelEscalationMode(authedPage, 'supported');

      await goToProject(authedPage, `agent-tasks/${CANCEL_ESCALATION_TEST_TASK_ID}`);
      await expect(authedPage.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 10000 });
      await authedPage.clock.install();

      const cancelButton = authedPage.getByTestId('agent-tasks__message-active-run-cancel').first();
      await expect(cancelButton).toBeVisible({ timeout: 10000 });
      const cancelRequest = authedPage.waitForRequest((request) =>
        isAgentTaskCancelRequestMode(request, 'cancel'),
      );
      const cancelResponse = waitForAgentTaskCancelResponse(authedPage, 'cancel');
      await cancelButton.click();
      expectCancelRequestMode(await cancelRequest, 'cancel');
      await expectAgentTaskCancelAcceptedResponse(await cancelResponse, {
        status: 'cancelling',
        stopMode: 'cancel',
        canEscalate: true,
      });

      await expect(agentTaskActiveRunFooter(authedPage).getByTestId('agent-tasks__message-active-run-status')).toContainText(/cancelling/i);
      await expect(agentTaskActiveRunFooter(authedPage).getByTestId('agent-tasks__message-active-run-latest-action')).toContainText(/waiting|stop|停止|结束/i);
      await expect(agentTaskConversationTextarea(authedPage)).toBeDisabled();
      const authoritativeRefetch = waitForAgentTaskCancelEscalationRefetch(authedPage);
      await expect(agentTaskEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
      await authedPage.clock.fastForward(30_000);
      await authoritativeRefetch;

      const dialog = await openAgentTaskEscalationDialog(authedPage);
      const terminateRequest = authedPage.waitForRequest((request) =>
        isAgentTaskCancelRequestMode(request, 'terminate'),
      );
      const terminateResponse = waitForAgentTaskCancelResponse(authedPage, 'terminate');

      await dialog
        .getByTestId('agent-tasks__cancel-escalation-confirm')
        .or(dialog.getByRole('button', { name: /terminate|force stop|confirm|run_escalation_confirm|强制|结束/i }))
        .first()
        .click();
      expectCancelRequestMode(await terminateRequest, 'terminate');
      await expectAgentTaskCancelAcceptedResponse(await terminateResponse, {
        status: 'terminating',
        stopMode: 'terminate',
        canEscalate: false,
        escalationReason: 'already_terminating',
      });

      await expect(agentTaskActiveRunFooter(authedPage).getByTestId('agent-tasks__message-active-run-status')).toContainText(/stopping/i);
      await expect(agentTaskActiveRunFooter(authedPage).getByTestId('agent-tasks__message-active-run-latest-action')).toContainText(/ending|execution environment|finish stopping|结束/i);
      await expect(agentTaskConversationTextarea(authedPage)).toBeDisabled();
      await expect(authedPage.getByTestId('agent-tasks__send-btn')).toBeDisabled();

      await authedPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(authedPage.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 10000 });
      await expect(agentTaskActiveRunFooter(authedPage).getByTestId('agent-tasks__message-active-run-status')).toContainText(/stopping/i);
      await expect(agentTaskConversationTextarea(authedPage)).toBeDisabled();
      await expect(authedPage.getByTestId('agent-tasks__send-btn')).toBeDisabled();
    });

    test('should return authoritative unsupported cancel and terminate contracts', async ({ authedPage }) => {
      await goToProject(authedPage, 'agent-tasks');
      const taskId = await createMockRunningAgentTask(
        authedPage,
        `Unsupported cancel contract ${Date.now()}`,
      );

      const cancel = await fetchAgentTaskCancelContract(authedPage, {
        taskId,
        mode: 'cancel',
        escalationMode: 'unsupported',
      });
      expect(cancel.status).toBe(202);
      expect(cancel.payload).toMatchObject({
        status: 'cancelling',
        task_id: taskId,
        mode: 'cancel',
        can_escalate: false,
        escalation_reason: 'unsupported_runner',
      });

      const terminate = await fetchAgentTaskCancelContract(authedPage, {
        taskId,
        mode: 'terminate',
        escalationMode: 'unsupported',
      });
      expect(terminate.status).toBe(409);
      expect(terminate.payload).toMatchObject({
        error_code: 'STOP_ESCALATION_UNAVAILABLE',
        message: 'stop_escalation_unavailable',
        task_id: taskId,
        status: 'cancelling',
        mode: 'cancel',
        can_escalate: false,
        escalation_reason: 'unsupported_runner',
      });
    });
  });
});
