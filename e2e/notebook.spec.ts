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

      // Close dialog
      await authedPage.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    test('should navigate to task detail on card click', async ({ authedPage }) => {
      const taskCards = authedPage.getByTestId('notebook__task-card');
      await expect(taskCards.first()).toBeVisible({ timeout: 10000 });

      // Get the task ID from the card for URL verification
      const taskId = await taskCards.first().getAttribute('data-task-id');

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

      await dialog.getByTestId('notebook__edit-task-status').click();
      await authedPage.getByRole('option', { name: /closed/i }).click();
      await dialog.getByTestId('notebook__edit-task-save').click();

      const request = await patchRequestPromise;
      const payload = request.postDataJSON() as { title?: string; status?: string };
      expect(payload.title).toBe('Updated Task From E2E');
      expect(payload.status).toBe('closed');
    });

    test('should navigate back to list when clicking leave button', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /leave/i }).click();
      await authedPage.waitForURL(/\/notebook$/);
      await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
    });

    test('should open add files dialog with disabled confirm before selection', async ({ authedPage }) => {
      await authedPage.getByRole('button', { name: /^files$/i }).click();
      const dialog = authedPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: /add selected/i })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible();
    });
  });
});
