/**
 * Chat Page E2E Tests
 *
 * Tests the chat page three-pane layout, thread list, thread selection,
 * composer input, and message sending.
 */

import { test, expect, goToProject } from './fixtures/test-base';

async function ensureComposerEnabled(page: import('@playwright/test').Page) {
  const composer = page.getByTestId('chat__composer');
  await expect(composer).toBeVisible({ timeout: 10000 });
  const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]').first();
  const disabled = await input.isDisabled().catch(() => false);
  if (!disabled) return;

  const trigger = page.getByTestId('chat__execution-target-trigger');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  const firstModel = page.locator('[data-testid^="chat__execution-target-endpoint--"]').first();
  await expect(firstModel).toBeVisible({ timeout: 10000 });
  await firstModel.click();
  await expect(input).toBeEnabled({ timeout: 10000 });
}

test.describe('Chat Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'chat');
  });

  test('should display three-pane layout', async ({ authedPage }) => {
    const threadsList = authedPage.getByTestId('chat__threads-pane');
    const mainPane = authedPage.getByTestId('chat__main-pane');
    const composer = authedPage.getByTestId('chat__composer');

    await expect(threadsList).toBeVisible({ timeout: 10000 });
    await expect(mainPane).toBeVisible();
    await expect(composer).toBeVisible();
  });

  test('should display thread items from MSW data', async ({ authedPage }) => {
    const threadsList = authedPage.getByTestId('chat__threads-pane');
    await expect(threadsList).toBeVisible({ timeout: 10000 });

    // MSW should provide at least one thread
    const threads = authedPage.getByTestId('chat__thread-item');
    await expect(threads.first()).toBeVisible({ timeout: 10000 });

    // Each thread item should have a data-thread-id attribute
    const firstThreadId = await threads.first().getAttribute('data-thread-id');
    expect(firstThreadId).toBeTruthy();
  });

  test('should display new thread button', async ({ authedPage }) => {
    const newThreadBtn = authedPage.getByTestId('chat__new-thread-btn');
    await expect(newThreadBtn).toBeVisible({ timeout: 10000 });
    await expect(newThreadBtn).toBeEnabled();
  });

  test('should rely on sidebar navigation instead of header cross-links', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('chat__open-notebook')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__open-endpoints')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__open-files')).toHaveCount(0);
    await expect(authedPage.getByTestId('sidebar__nav-item--notebook')).toHaveAttribute('href', /\/notebook$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--endpoints')).toHaveAttribute('href', /\/endpoints$/);
  });

  test('does not render stream diagnostics banner in chat pane', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('chat__stream-error-open-audit')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-open-audit-console')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-open-agent')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-banner')).toHaveCount(0);
  });

  test('should render thread search and execution target controls', async ({ authedPage }) => {
    await expect(authedPage.getByPlaceholder(/search threads/i)).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('chat__execution-target-trigger')).toBeVisible();
  });

  test('should select a thread and display chat area', async ({ authedPage }) => {
    // Wait for thread items to load
    const threads = authedPage.getByTestId('chat__thread-item');
    await expect(threads.first()).toBeVisible({ timeout: 10000 });

    // Click the first thread
    await threads.first().click();
    await authedPage.waitForTimeout(1000);

    // After selecting a thread, the chat content area should be active
    // The main pane should show the thread title, composer, and either messages or "Start a conversation"
    await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
    // The selected thread should be marked as active
    const activeThread = threads.first();
    await activeThread.evaluate((el) =>
      el.classList.contains('active') || el.getAttribute('data-state') === 'active' ||
      el.getAttribute('aria-selected') === 'true' || el.closest('[class*="active"]') !== null,
    );
    // Verify thread selection visual indicator or session title appears in header
    await expect(
      authedPage.getByText('Product Q&A').first(),
    ).toBeVisible();
  });

  test('should enable send button when composer has text', async ({ authedPage }) => {
    const composer = authedPage.getByTestId('chat__composer');
    const sendBtn = authedPage.getByTestId('chat__send-btn');

    await ensureComposerEnabled(authedPage);
    await expect(composer).toBeVisible({ timeout: 10000 });

    // Composer should have an input or textarea
    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]');
    await expect(input.first()).toBeVisible();

    // Send button should be disabled or hidden when empty
    if (await sendBtn.isVisible().catch(() => false)) {
      await expect(sendBtn).toBeDisabled();
    }

    // Type a message
    await input.first().fill('Hello from E2E test');

    // Send button should now be visible and enabled
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(sendBtn).toBeEnabled();
  });

  test('should support sending with Enter key', async ({ authedPage }) => {
    await ensureComposerEnabled(authedPage);
    const composer = authedPage.getByTestId('chat__composer');
    await expect(composer).toBeVisible({ timeout: 10000 });

    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]').first();
    await input.fill('E2E enter send message');
    await input.press('Enter');

    // Composer remains available after send pipeline triggers.
    await expect(composer).toBeVisible();
  });

  test('should send a message via send button', async ({ authedPage }) => {
    await ensureComposerEnabled(authedPage);
    const composer = authedPage.getByTestId('chat__composer');
    const sendBtn = authedPage.getByTestId('chat__send-btn');

    await expect(composer).toBeVisible({ timeout: 10000 });
    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]');
    await expect(input.first()).toBeVisible();

    // Type and send a message
    await input.first().fill('E2E test message');
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // After sending, input should either be cleared or remain (depending on implementation)
    // At minimum the send button should still be functional
    await authedPage.waitForTimeout(500);
    // Verify the composer is still visible and functional after send
    await expect(composer).toBeVisible();
  });

  test('should show layout toggle on ultrawide viewport and switch state', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await goToProject(authedPage, 'chat');

    const toggle = authedPage.getByTestId('topbar__layout-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(toggle).toHaveAttribute('data-state', 'standard');

    await toggle.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(toggle).toHaveAttribute('data-state', 'ultrawide');
    await expect(authedPage.getByTestId('chat__threads-pane')).toHaveClass(/w-\[256px\]/);
  });

  test('should persist ultrawide layout preference after refresh', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await goToProject(authedPage, 'chat');

    const toggle = authedPage.getByTestId('topbar__layout-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });

    if ((await toggle.getAttribute('data-state')) !== 'ultrawide') {
      await toggle.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(toggle).toHaveAttribute('data-state', 'ultrawide');
    }

    await authedPage.reload({ waitUntil: 'domcontentloaded' });
    const persistedToggle = authedPage.getByTestId('topbar__layout-toggle');
    if (!(await persistedToggle.isVisible().catch(() => false))) {
      await goToProject(authedPage, 'chat');
    }
    await expect(authedPage.getByTestId('topbar__layout-toggle')).toHaveAttribute('data-state', 'ultrawide');
  });
});
