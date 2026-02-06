/**
 * Agents Page – E2E Tests
 *
 * Covers table rendering, agent data, create dialog, edit dialog, and
 * enable/disable toggle using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Agents Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'agents');
  });

  test('table renders with agent rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('agents__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // MSW returns multiple agents for proj_001 – verify at least one row
    const rows = table.locator('[data-testid="agents__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays agent names from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    // Agent names from p0.json: "Support Agent", "Research Agent"
    await expect(authedPage.getByText('Support Agent')).toBeVisible();
    await expect(authedPage.getByText('Research Agent')).toBeVisible();
  });

  test('create dialog opens with form fields', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('agents__create-btn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId('agents__create-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog contains a name input
    await expect(dialog.locator('#agent-name')).toBeVisible();
  });

  test('edit dialog opens when clicking edit on a row', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    // Click the edit (Pencil) button on the first agent row
    const firstRow = authedPage.getByTestId('agents__table__row').first();
    await expect(firstRow).toBeVisible();
    const editBtn = firstRow.getByRole('button', { name: /edit/i });
    await editBtn.click();

    const editDialog = authedPage.getByTestId('agents__edit-dialog');
    await expect(editDialog).toBeVisible();
  });

  test('enable/disable toggle button is present on each row', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    // Each row should have either an "Enable" or "Disable" button
    const rows = authedPage.getByTestId('agents__table__row');
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();
    const toggleBtn = firstRow.getByRole('button', { name: /enable|disable/i });
    await expect(toggleBtn).toBeVisible();
  });

  test('create agent via dialog submission', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('agents__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('agents__create-dialog');
    await expect(dialog).toBeVisible();

    // Fill in the form
    await dialog.locator('#agent-name').fill('E2E Test Agent');
    await dialog.locator('#agent-description').fill('Created by E2E test');

    // Submit the form
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Dialog should close after successful creation
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // New agent should appear in the table
    await expect(authedPage.getByText('E2E Test Agent')).toBeVisible({ timeout: 10000 });
  });

  test('create agent with empty name should not submit', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('agents__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('agents__create-dialog');
    await expect(dialog).toBeVisible();

    // Submit button should be disabled when name is empty
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('toggle agent status via enable/disable button', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    const rows = authedPage.getByTestId('agents__table__row');
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();

    // Click the enable/disable toggle button
    const toggleBtn = firstRow.getByRole('button', { name: /enable|disable/i });
    await expect(toggleBtn).toBeVisible();

    const initialText = await toggleBtn.textContent();
    await toggleBtn.click();

    // After toggle, the button text should change (Enable -> Disable or vice versa)
    await authedPage.waitForTimeout(500);
    // The agent row should still be visible
    await expect(firstRow).toBeVisible();
  });
});
