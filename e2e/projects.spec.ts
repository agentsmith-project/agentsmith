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

  test('should create project with visibility and join policy options', async ({ authedPage }) => {
    const createBtn = authedPage.getByTestId('projects__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('#project-name').fill('Policy Config Project');
    await dialog.locator('#project-description').fill('Created with explicit policy options');

    // First select: visibility
    const selects = dialog.locator('[role="combobox"]');
    const visibilitySelect = selects.nth(0);
    await visibilitySelect.click();
    await authedPage.getByRole('option', { name: /public/i }).click();

    // Second select: join policy
    const joinPolicySelect = selects.nth(1);
    await joinPolicySelect.click();
    await authedPage.getByRole('option', { name: /^Open$/ }).click();

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects$/.test(req.url());
    });

    await dialog.getByRole('button', { name: /create/i }).click();

    const request = await createRequestPromise;
    const payload = request.postDataJSON() as {
      name?: string;
      description?: string;
      visibility?: string;
      join_policy?: string;
    };
    expect(payload.name).toBe('Policy Config Project');
    expect(payload.visibility).toBe('public');
    expect(payload.join_policy).toBe('open');
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

  test('should open project settings from actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });

    const enabledSettingsButtons = authedPage.locator('button[aria-label="Project settings"]:not([disabled])');
    const enabledCount = await enabledSettingsButtons.count();

    if (enabledCount === 0) {
      const disabledSettingsButtons = authedPage.locator('button[aria-label="Project settings"][disabled]');
      await expect(disabledSettingsButtons.first()).toBeVisible();
      return;
    }

    await enabledSettingsButtons.first().click();

    await authedPage.waitForURL(/\/projects\/.*\/settings/, { timeout: 15000 });
    await expect(authedPage.getByRole('heading', { name: /project settings/i })).toBeVisible({ timeout: 10000 });
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

  test('should delete project through row overflow action', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('projects__table')).toBeVisible({ timeout: 10000 });
    const initialRows = authedPage.getByTestId('projects__table__row');
    const initialCount = await initialRows.count();
    expect(initialCount).toBeGreaterThan(0);

    const moreActionsButtons = authedPage.locator('button[aria-label="More actions"]');
    const actionCount = await moreActionsButtons.count();
    if (actionCount === 0) {
      await expect(authedPage.getByTestId('projects__table')).toBeVisible();
      return;
    }

    await moreActionsButtons.first().click();
    await authedPage.getByRole('menuitem', { name: /delete/i }).click();

    const deleteRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'DELETE' && /\/api\/v1\/workspaces\/.*\/projects\/.+/.test(req.url());
    });

    // ConfirmationDialog uses destructive delete action
    await authedPage.getByRole('button', { name: /^Delete$/ }).last().click();
    await deleteRequestPromise;

    await expect(authedPage.getByRole('dialog')).toBeHidden({ timeout: 10000 });
  });
});
