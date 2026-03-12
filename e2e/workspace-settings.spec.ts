import { test, expect, goTo, LOCALE, WS_ID } from './fixtures/test-base';

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
    await expect(authedPage.getByTestId('ws-settings__project-open-overview--proj_001')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-open-members--proj_001')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-open-settings--proj_001')).toBeVisible();
    await expect(authedPage.getByTestId('ws-settings__project-edit-admins--proj_001')).toBeVisible();
  });

  test('workspace admin can open create project dialog and create a project', async ({ authedPage }) => {
    await authedPage.getByTestId('ws-settings__create-project').click();
    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).toBeVisible();

    await authedPage.getByLabel('Project Name').fill('Workspace Admin Project');
    await authedPage.getByRole('button', { name: /^Create$/i }).click();

    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).not.toBeVisible();
  });

  test('workspace admin can assign project admins', async ({ authedPage }) => {
    await authedPage.getByTestId('ws-settings__project-edit-admins--proj_001').click();
    await expect(authedPage.getByTestId('ws-settings__project-admin-dialog')).toBeVisible();
    await authedPage.getByRole('checkbox', { name: /Dev Two/i }).click();
    await authedPage.getByTestId('ws-settings__project-admin-save').click();
    await expect(authedPage.getByTestId('ws-settings__project-admin-dialog')).not.toBeVisible();
  });
});
