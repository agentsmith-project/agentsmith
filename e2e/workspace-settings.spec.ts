import { test, expect, goTo, LOCALE, WS_ID } from './fixtures/test-base';
import { withAuth } from './fixtures/authenticated';

const wsSettingsPath = `/${LOCALE}/workspaces/${WS_ID}/settings`;

test.describe('Workspace Settings Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, wsSettingsPath);
  });

  test('shows workspace administration summary and project actions', async ({ authedPage }) => {
    await expect(
      authedPage.getByRole('heading', { name: /Workspace Settings/i }),
    ).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__workspace')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__projects')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__name')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__open-projects')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__create-project')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-creators')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-open-overview--proj_001')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-open-members--proj_001')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-open-settings--proj_001')).toBeVisible();
  });

  test('workspace manager can open create project dialog and create a project', async ({ authedPage }) => {
    await authedPage.getByTestId('ws-settings__create-project').click();
    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).toBeVisible();

    await authedPage.getByLabel('Project Name').fill('Workspace Admin Project');
    await authedPage.getByRole('button', { name: /^Create$/i }).click();

    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).not.toBeVisible();
  });

  test('workspace manager can save project creators', async ({ authedPage }) => {
    await authedPage.getByTestId('ws-settings__project-creators-input').fill('user_alt');
    await authedPage.getByTestId('ws-settings__project-creators-save').click();
    await expect(authedPage.getByTestId('ws-settings__project-creators-input')).toHaveValue('user_alt');
  });

  test('workspace manager can transfer project ownership', async ({ authedPage }) => {
    const projectCard = authedPage.getByTestId('ws-settings__project--proj_001');
    const ownerSelect = authedPage.getByTestId('ws-settings__project-owner-select--proj_001');
    await expect(projectCard).toBeVisible();
    await expect(ownerSelect).toBeVisible();
    const optionValues = await ownerSelect.locator('option').evaluateAll((options) =>
      options.map((option) => ({ value: option.getAttribute('value') ?? '', label: option.textContent ?? '' })),
    );
    const currentValue = await ownerSelect.inputValue();
    const nextOwner = optionValues.find((option) => option.value && option.value !== currentValue);
    expect(nextOwner).toBeTruthy();

    await ownerSelect.selectOption(nextOwner!.value);
    await authedPage.getByTestId('ws-settings__project-owner-save--proj_001').click();
    await expect(projectCard.getByText(new RegExp(`Current owner:.*${nextOwner!.label.trim()}`, 'i'))).toBeVisible();
  });

  test('project creators can create projects without workspace administration access', async ({ page }) => {
    await withAuth(page, WS_ID, 'dev2@corp.com', 'u_2');
    await goTo(page, wsSettingsPath);
    await expect(page.getByRole('heading', { name: /Permission Denied/i })).toBeVisible();

    await goTo(page, `/${LOCALE}/workspaces/${WS_ID}`);
    await expect(page.getByTestId('workspace-home__page')).toBeVisible();
    await expect(page.getByTestId('workspace-home__open-projects')).toBeVisible();
    await expect(page.getByTestId('workspace-home__projects-section')).toBeVisible();
    await expect(page.getByTestId('workspace-home__projects-section')).toContainText(/workspace_projects_title|Projects/i);
    await expect(page.getByTestId('workspace-home__admin-section')).toHaveCount(0);

    await page.getByTestId('workspace-home__open-projects').click();
    await page.waitForURL(new RegExp(`/workspaces/${WS_ID}/projects$`), { timeout: 10_000 });
    await expect(page.getByTestId('projects__create-btn')).toBeEnabled();
    await expect(page.getByTestId('projects__back-to-workspace')).toBeVisible();
  });

  test('project creators become project owners for projects they create', async ({ page }) => {
    await withAuth(page, WS_ID, 'dev2@corp.com', 'u_2');
    await goTo(page, wsSettingsPath);
    await expect(page.getByRole('heading', { name: /Permission Denied/i })).toBeVisible();

    await goTo(page, `/${LOCALE}/workspaces/${WS_ID}`);
    await expect(page.getByTestId('workspace-home__page')).toBeVisible();
    await page.getByTestId('workspace-home__open-projects').click();
    await page.waitForURL(new RegExp(`/workspaces/${WS_ID}/projects$`), { timeout: 10_000 });
    await expect(page.getByTestId('projects__create-btn')).toBeEnabled();

    const projectName = `Creator Owned ${Date.now()}`;
    await page.getByTestId('projects__create-btn').click();
    await expect(page.getByRole('heading', { name: /Create Project/i })).toBeVisible();
    await page.getByLabel('Project Name').fill(projectName);
    await page.getByRole('button', { name: /^Create$/i }).click();

    await page.waitForURL(new RegExp(`/workspaces/${WS_ID}/projects/.+/overview$`), { timeout: 10_000 });
    await expect(page.getByTestId('sidebar__nav-item--settings')).toBeVisible();

    await page.getByTestId('sidebar__nav-item--settings').click();
    await page.waitForURL(new RegExp(`/workspaces/${WS_ID}/projects/.+/settings$`), { timeout: 10_000 });

    await expect(page.getByTestId('settings__project-admins-save')).toBeVisible();
    await expect(page.getByTestId('settings__project-owner-save')).toBeVisible();
    await expect(page.getByTestId('settings__delete-project-btn')).toBeEnabled();
  });
});
