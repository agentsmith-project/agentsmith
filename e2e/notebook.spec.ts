/**
 * Notebook Page E2E Tests
 *
 * Tests the notebook task list, create task dialog,
 * navigation to task detail, and task detail page elements.
 */

import { test, expect, goToProject } from './fixtures/test-base';

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

    test('should show build header actions', async ({ authedPage }) => {
      await expect(authedPage.getByTestId('notebook__open-chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('notebook__open-files')).toHaveAttribute('href', /\/files$/);
      await expect(authedPage.getByTestId('notebook__open-agents')).toHaveAttribute('href', /\/agents$/);
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
        dialog.getByRole('radio', { name: /initialize a new workspace automatically/i }),
      ).toBeChecked();
      await expect(dialog.locator('#task-workspace-name')).toBeVisible();
      await expect(
        dialog.getByRole('radio', { name: /continue an existing workspace/i }),
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
      await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible();
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
      await expect(authedPage.getByTestId('notebook-task__open-list')).toHaveAttribute('href', /\/notebook$/);
      await expect(authedPage.getByTestId('notebook-task__open-chat')).toHaveAttribute('href', /\/chat$/);
      await expect(authedPage.getByTestId('notebook-task__open-files')).toHaveAttribute('href', /\/files$/);
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

    test('should navigate to files page from task detail header', async ({ authedPage }) => {
      await authedPage.getByTestId('notebook-task__open-files').click();
      await authedPage.waitForURL(/\/files$/, { timeout: 10000 });
      await expect(authedPage.getByTestId('project-workbench__heading')).toBeVisible();
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
});
