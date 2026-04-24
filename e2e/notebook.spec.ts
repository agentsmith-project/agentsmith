/**
 * Notebook Page E2E Tests
 *
 * Tests the notebook task list, create task dialog,
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
  stop_mode?: string;
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

function notebookRunSummary(page: Page) {
  return page.getByTestId('notebook__run-activity-summary');
}

function notebookConversationTextarea(page: Page) {
  return page
    .getByTestId('notebook__conversation-input')
    .locator('textarea, input[type="text"], [contenteditable="true"]')
    .first();
}

function notebookEscalationDialog(page: Page) {
  return page
    .getByTestId('notebook__cancel-escalation-dialog')
    .or(page.getByRole('alertdialog').filter({ hasText: /terminate|force stop|escalat|run_escalation|强制|结束/i }))
    .or(page.getByRole('dialog').filter({ hasText: /terminate|force stop|escalat|run_escalation|强制|结束/i }))
    .first();
}

function waitForNotebookCancelEscalationRefetch(page: Page, mode: TaskCancelEscalationMode = 'supported') {
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

function isNotebookCancelRequest(request: import('@playwright/test').Request, taskId = CANCEL_ESCALATION_TEST_TASK_ID) {
  return request.method() === 'POST'
    && new RegExp(`/api/v1/workspaces/.*/projects/.*/tasks/${taskId}/cancel`).test(request.url());
}

function isNotebookCancelRequestMode(
  request: import('@playwright/test').Request,
  mode: TaskCancelMode,
  taskId = CANCEL_ESCALATION_TEST_TASK_ID,
) {
  const body = request.postData() ?? '';
  return isNotebookCancelRequest(request, taskId)
    && new RegExp(`"mode"\\s*:\\s*"${mode}"`).test(body);
}

function expectCancelRequestMode(request: import('@playwright/test').Request, mode: TaskCancelMode) {
  const payload = parseRequestBodyJson(request);
  expect(payload.mode).toBe(mode);
  if ('stop_mode' in payload) {
    expect(payload.stop_mode).toBe(mode);
  }
}

function waitForNotebookCancelResponse(
  page: Page,
  mode: TaskCancelMode,
  taskId = CANCEL_ESCALATION_TEST_TASK_ID,
) {
  return page.waitForResponse((response) =>
    isNotebookCancelRequestMode(response.request(), mode, taskId), { timeout: 30_000 });
}

async function expectNotebookCancelAcceptedResponse(
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
  expect(payload.stop_mode).toBe(options.stopMode);
  expect(payload.can_escalate).toBe(options.canEscalate);
  if ('escalationReason' in options) {
    expect(payload.escalation_reason ?? null).toBe(options.escalationReason ?? null);
  } else {
    expect(payload.escalation_reason).toBeUndefined();
  }
  return payload;
}

async function createMockRunningNotebookTask(page: Page, title: string) {
  return page.evaluate(async (taskTitle) => {
    const response = await fetch('/api/v1/workspaces/ws_001/projects/proj_001/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        agent_id: 'ag_2',
        agent_name: 'Research Agent',
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

async function fetchNotebookCancelContract(
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

async function openNotebookEscalationDialog(page: Page) {
  const dialog = notebookEscalationDialog(page);
  const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (dialogVisible) return dialog;

  const escalationTrigger = page
    .getByTestId('notebook__cancel-escalation-trigger')
    .or(page.getByRole('button', { name: /terminate|force stop|escalat|upgrade|run_escalation|强制|结束/i }))
    .first();
  await expect(escalationTrigger).toBeVisible({ timeout: 10000 });
  await escalationTrigger.click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe('Notebook Page', () => {
  test.describe('Task List', () => {
    test.beforeEach(async ({ authedPage }) => {
      await goToProject(authedPage, 'notebook');
    });

    test('should display task list with task cards', async ({ authedPage }) => {
      const taskList = authedPage.getByTestId('notebook__task-list');
      await expect(taskList).toBeVisible({ timeout: 10000 });

      // MSW should provide at least one task card
      const taskCards = authedPage.getByTestId('notebook__task-card');
      await expect(taskCards.first()).toBeVisible({ timeout: 10000 });

      // Each task card should have a data-task-id attribute
      const firstTaskId = await taskCards.first().getAttribute('data-task-id');
      expect(firstTaskId).toBeTruthy();
    });

    test('should display create task button', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('notebook__create-task-btn');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
      await expect(createBtn).toBeEnabled();
    });

    test('should rely on sidebar navigation instead of build header actions', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('notebook__open-chat')).toHaveCount(0);
      await expect(authedPage.getByTestId('notebook__open-files')).toHaveCount(0);
      await expect(authedPage.getByTestId('notebook__open-agents')).toHaveCount(0);
      await expect(authedPage.getByTestId('sidebar__nav-item--chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--agents')).toHaveAttribute('href', /\/agents$/);
    });

    test('should open create task dialog', async ({ authedPage }) => {
      const createBtn = authedPage.getByTestId('notebook__create-task-btn');
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
      const taskCards = authedPage.getByTestId('notebook__task-card');
      await expect(taskCards.first()).toBeVisible({ timeout: 10000 });

      // Get the task ID from the card for URL verification
      const _taskId = await taskCards.first().getAttribute('data-task-id');

      // Click the first task card
      await taskCards.first().click();

      // Should navigate to the task detail page
      await authedPage.waitForURL(/\/notebook\/tasks\//, { timeout: 10000 });

      // Task header should be visible on detail page
      const taskHeader = authedPage.getByTestId('notebook__task-header');
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
      await goToProject(authedPage, 'notebook/tasks/task_001');
    });

    test('should display task header', async ({ authedPage }) => {
      const header = authedPage.getByTestId('notebook__task-header');
      await expect(header).toBeVisible({ timeout: 10000 });
      await expect(authedPage.getByTestId('notebook__task-header-workspace-library')).toBeVisible();
      await expect(authedPage.getByTestId('notebook__task-header-agent-mode')).toBeVisible();
      await expect(authedPage.getByTestId('notebook-task__open-list')).toHaveCount(0);
      await expect(authedPage.getByTestId('notebook-task__open-chat')).toHaveCount(0);
      await expect(authedPage.getByTestId('notebook-task__open-files')).toHaveCount(0);
      await expect(authedPage.getByTestId('sidebar__nav-item--notebook')).toHaveAttribute('href', /\/notebook$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
    });

    test('should expose diagnostics links from realtime status when status is visible', async ({ authedPage }) => {
      const auditLink = authedPage.getByTestId('notebook__sse-status-open-audit');
      if (!(await auditLink.isVisible().catch(() => false))) {
        test.skip(true, 'Current MSW notebook lane does not surface realtime status by default.');
      }

      await expect(auditLink).toHaveAttribute('href', /\/audit(\?|$)/);
    });

    test('should display conversation input and send button', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('notebook__conversation-input');
      const sendBtn = authedPage.getByTestId('notebook__send-btn');

      await expect(conversationInput).toBeVisible({ timeout: 10000 });
      await expect(sendBtn).toBeVisible();
    });

    test('should display artifact cards if available', async ({ authedPage }) => {
      // Artifacts may or may not be present depending on MSW data
      const artifactCards = authedPage.getByTestId('notebook__artifact-card');
      const count = await artifactCards.count();

      if (count > 0) {
        await expect(artifactCards.first()).toBeVisible();
        const artifactId = await artifactCards.first().getAttribute('data-artifact-id');
        expect(artifactId).toBeTruthy();
      }
    });

    test('should allow typing in conversation input', async ({ authedPage }) => {
      const conversationInput = authedPage.getByTestId('notebook__conversation-input');
      await expect(conversationInput).toBeVisible({ timeout: 10000 });

      const input = conversationInput.locator(
        'textarea, input[type="text"], [contenteditable="true"]',
      );
      await expect(input.first()).toBeVisible();

      await input.first().fill('Test task prompt');

      const sendBtn = authedPage.getByTestId('notebook__send-btn');
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

      const titleInput = dialog.getByTestId('notebook__edit-task-title');
      await titleInput.fill('Updated Task From E2E');
      await dialog.getByTestId('notebook__edit-task-save').click();

      const request = await patchRequestPromise;
      const payload = request.postDataJSON() as { title?: string };
      expect(payload.title).toBe('Updated Task From E2E');
    });

    test('should navigate back to list when clicking leave button', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /leave/i }).click();
      await authedPage.waitForURL(/\/notebook$/);
      await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
    });

    test('should remove deleted task from list immediately after returning from detail', async ({ authedPage }) => {
      const deletedTaskTitle = 'Product Documentation Analysis';

      await expect(authedPage.getByRole('heading', { name: deletedTaskTitle })).toBeVisible();

      await authedPage.getByRole('button', { name: /delete task|^delete$/i }).click();

      const dialog = authedPage.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /delete task|^delete$/i }).click();

      await authedPage.waitForURL(/\/notebook$/);
      await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
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
      const traceToggle = authedPage.getByTestId('notebook__message-trace-toggle').first();
      if (!(await traceToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip(true, 'Current MSW notebook lane does not prehydrate execution details by default.');
      }
      await expect(traceToggle).toBeVisible({ timeout: 10000 });
      await traceToggle.click();
      await expect(authedPage.getByTestId('notebook__message-trace-panel')).toBeVisible();
      await expect(
        authedPage.getByTestId('notebook__message-trace-empty').or(
          authedPage.getByTestId('notebook__trace-step').first(),
        ),
      ).toBeVisible();
    });

    test('should switch trace views, filter events, and show load earlier logs', async ({ authedPage }) => {
      const traceToggle = authedPage.getByTestId('notebook__message-trace-toggle').first();
      if (!(await traceToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip(true, 'Current MSW notebook lane does not prehydrate execution details by default.');
      }
      await expect(traceToggle).toBeVisible({ timeout: 10000 });
      await traceToggle.click();

      const panel = authedPage.getByTestId('notebook__message-trace-panel');
      await expect(panel).toBeVisible();

      await authedPage.getByTestId('notebook__message-trace-view-raw').click();
      await expect(authedPage.getByTestId('notebook__message-trace-raw')).toBeVisible();

      await authedPage.getByTestId('notebook__message-trace-filter-alerts').click();
      await expect(authedPage.getByTestId('notebook__message-trace-stats')).toBeVisible();

      const loadMore = authedPage.getByTestId('notebook__message-trace-load-more');
      await expect(loadMore).toBeVisible();
      await loadMore.click();

      await expect(authedPage.getByTestId('notebook__message-trace-body')).toBeVisible();
    });

    test('should allow copying trace logs after filtering', async ({ authedPage, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const traceToggle = authedPage.getByTestId('notebook__message-trace-toggle').first();
      if (!(await traceToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
        test.skip(true, 'Current MSW notebook lane does not prehydrate execution details by default.');
      }
      await expect(traceToggle).toBeVisible({ timeout: 10000 });
      await traceToggle.click();

      await authedPage.getByTestId('notebook__message-trace-view-raw').click();
      await authedPage.getByTestId('notebook__message-trace-filter-alerts').click();

      const copyButton = authedPage.getByTestId('notebook__message-trace-copy');
      await expect(copyButton).toBeVisible();
      await copyButton.click();

      await expect(authedPage.getByTestId('notebook__message-trace-panel')).toBeVisible();
    });
  });

  test.describe.serial('Realtime Reconciliation', () => {
    test('should keep an active hook-level connection error visible after cancel reconcile succeeds', async ({ authedPage }) => {
      await setMockTaskRealtimeMode(authedPage, 'sse_ticket_upstream');

      await goToProject(authedPage, `notebook/tasks/${REALTIME_TEST_TASK_ID}`);
      await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible({ timeout: 10000 });
      const cancelButton = authedPage.getByRole('button', { name: /^Cancel$/ });
      await expect(cancelButton).toBeVisible();

      const realtimeStatus = authedPage.getByTestId('notebook__sse-status');
      await expect(realtimeStatus).toContainText('Realtime ticket exchange failed');

      await cancelButton.click();

      await expect(cancelButton).toHaveCount(0);
      await expect(realtimeStatus).toContainText('Realtime ticket exchange failed');
      await expect(authedPage.getByTestId('notebook__conversation-input')).toBeVisible();
    });

    test('should escalate a stuck notebook cancel to terminate and keep sending blocked after refetch', async ({ authedPage }) => {
      await setMockTaskCancelEscalationMode(authedPage, 'supported');

      await goToProject(authedPage, `notebook/tasks/${CANCEL_ESCALATION_TEST_TASK_ID}`);
      await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible({ timeout: 10000 });
      await authedPage.clock.install();

      const cancelButton = authedPage
        .getByTestId('notebook__run-active-cancel')
        .or(authedPage.getByRole('button', { name: /^Cancel$/i }))
        .first();
      await expect(cancelButton).toBeVisible({ timeout: 10000 });
      const cancelRequest = authedPage.waitForRequest((request) =>
        isNotebookCancelRequestMode(request, 'cancel'),
      );
      const cancelResponse = waitForNotebookCancelResponse(authedPage, 'cancel');
      await cancelButton.click();
      expectCancelRequestMode(await cancelRequest, 'cancel');
      await expectNotebookCancelAcceptedResponse(await cancelResponse, {
        status: 'cancelling',
        stopMode: 'cancel',
        canEscalate: true,
      });

      await expect(notebookRunSummary(authedPage)).toContainText(/waiting|stop|停止|结束/i);
      await expect(notebookConversationTextarea(authedPage)).toBeDisabled();
      const authoritativeRefetch = waitForNotebookCancelEscalationRefetch(authedPage);
      await expect(notebookEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
      await authedPage.clock.fastForward(30_000);
      await authoritativeRefetch;

      const dialog = await openNotebookEscalationDialog(authedPage);
      const terminateRequest = authedPage.waitForRequest((request) =>
        isNotebookCancelRequestMode(request, 'terminate'),
      );
      const terminateResponse = waitForNotebookCancelResponse(authedPage, 'terminate');

      await dialog
        .getByTestId('notebook__cancel-escalation-confirm')
        .or(dialog.getByRole('button', { name: /terminate|force stop|confirm|run_escalation_confirm|强制|结束/i }))
        .first()
        .click();
      expectCancelRequestMode(await terminateRequest, 'terminate');
      await expectNotebookCancelAcceptedResponse(await terminateResponse, {
        status: 'terminating',
        stopMode: 'terminate',
        canEscalate: false,
        escalationReason: 'already_terminating',
      });

      await expect(notebookRunSummary(authedPage)).toContainText(/ending|terminat|finish stopping|结束/i);
      await expect(notebookConversationTextarea(authedPage)).toBeDisabled();
      await expect(authedPage.getByTestId('notebook__send-btn')).toBeDisabled();

      await authedPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible({ timeout: 10000 });
      await expect(notebookRunSummary(authedPage)).toContainText(/ending|terminat|finish stopping|结束/i);
      await expect(notebookConversationTextarea(authedPage)).toBeDisabled();
      await expect(authedPage.getByTestId('notebook__send-btn')).toBeDisabled();
    });

    test('should return authoritative unsupported cancel and terminate contracts', async ({ authedPage }) => {
      await goToProject(authedPage, 'notebook');
      const taskId = await createMockRunningNotebookTask(
        authedPage,
        `Unsupported cancel contract ${Date.now()}`,
      );

      const cancel = await fetchNotebookCancelContract(authedPage, {
        taskId,
        mode: 'cancel',
        escalationMode: 'unsupported',
      });
      expect(cancel.status).toBe(202);
      expect(cancel.payload).toMatchObject({
        status: 'cancelling',
        task_id: taskId,
        stop_mode: 'cancel',
        can_escalate: false,
        escalation_reason: 'unsupported_runner',
      });

      const terminate = await fetchNotebookCancelContract(authedPage, {
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
        stop_mode: 'cancel',
        can_escalate: false,
        escalation_reason: 'unsupported_runner',
      });
    });
  });
});
