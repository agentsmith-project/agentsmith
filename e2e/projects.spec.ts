/**
 * Projects Page E2E Tests
 *
 * Tests the workspace-level projects list page including display,
 * search/filter, create dialog, pin/unpin, and navigation to project.
 */

import { test, expect, goTo, WS_ID, LOCALE } from './fixtures/test-base';

const projectsPath = `/${LOCALE}/workspaces/${WS_ID}/projects`;

test.describe('Projects Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, projectsPath);
  });

  test('should display projects list with heading and table', async ({ authedPage }) => {
    await expect(authedPage.locator('h1').filter({ hasText: /Projects/i })).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });

    // Table should contain at least one row
    const rows = authedPage.getByTestId('projects__table').locator('tbody tr, [role="row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display project data from MSW mock', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });

    // MSW provides "AI Assistant Project" as a seeded project
    await expect(authedPage.getByText('AI Assistant Project')).toBeVisible();
  });

  test('should search and filter projects', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });
    const searchInput = authedPage.getByTestId('projects__search');
    await expect(searchInput).toBeVisible();

    // Type a search query that matches existing project
    await searchInput.fill('AI Assistant');
    await expect(authedPage.getByText('AI Assistant Project')).toBeVisible();

    // Type a search query that matches nothing
    await searchInput.clear();
    await searchInput.fill('nonexistent-project-xyz');
    // The matching project should no longer appear
    await expect(authedPage.getByText('AI Assistant Project')).toBeHidden({ timeout: 5000 });
  });

  test('should open and close create project dialog', async ({ authedPage }) => {
    const createBtn = authedPage.getByTestId('projects__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    // Dialog should appear
    const dialog = authedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in form fields
    const nameInput = dialog.getByLabel(/name/i);
    await expect(nameInput).toBeVisible();
    await nameInput.fill('My New Project');

    const descInput = dialog.getByLabel(/description/i);
    if (await descInput.isVisible()) {
      await descInput.fill('A test project created by E2E');
    }

    // Close dialog via cancel or escape
    await authedPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('should toggle pin on a project', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });

    const pinBtn = authedPage.getByTestId('projects__pin-btn').first();
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
      // Pin button should still be present after toggle
      await expect(pinBtn).toBeVisible();
    }
  });

  test('should navigate to project overview on row click', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });

    // Find the project row and click its "Open" action button
    const projectRow = authedPage.getByTestId('projects__table__row').first();
    await expect(projectRow).toBeVisible();

    // Click the open/eye button in the actions column
    const openBtn = projectRow.getByRole('button', { name: /open/i });
    await expect(openBtn).toBeVisible();
    await openBtn.click();

    // Should navigate to the project overview page
    await authedPage.waitForURL(/\/projects\/.*\/overview/, { timeout: 15000 });
    await expect(authedPage.getByRole('heading', { name: /Overview/i })).toBeVisible({ timeout: 10000 });
  });

  test('should create a project via dialog submission', async ({ authedPage }) => {
    const createBtn = authedPage.getByTestId('projects__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in the project name (uses #project-name input)
    const nameInput = dialog.locator('#project-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Test Project');

    // Fill description
    const descInput = dialog.locator('#project-description');
    if (await descInput.isVisible()) {
      await descInput.fill('Created by E2E test');
    }

    // Submit the form
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Dialog should close after successful creation
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  test('should not submit create project with empty name', async ({ authedPage }) => {
    const createBtn = authedPage.getByTestId('projects__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Submit button should be disabled when name is empty
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeDisabled();
  });
});
