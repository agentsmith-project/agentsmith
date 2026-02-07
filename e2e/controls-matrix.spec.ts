import { test, expect, goTo, goToProject, LOCALE, WS_ID, PROJECT_ID } from './fixtures/test-base';

test.describe('Controls Matrix', () => {
  test('workspace pages expose primary controls', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await expect(authedPage.getByTestId('projects__search')).toBeVisible();
    await expect(authedPage.getByTestId('projects__create-btn')).toBeVisible();
    await expect(authedPage.getByTestId('projects__pin-btn').first()).toBeVisible();

    await goTo(authedPage, `/${LOCALE}/workspaces/${WS_ID}/settings`);
    await expect(authedPage.getByTestId('ws-settings__members')).toBeVisible();
  });

  test('project pages expose primary controls', async ({ authedPage }) => {
    test.setTimeout(120000);
    await goToProject(authedPage, 'overview');
    await expect(authedPage.getByTestId('overview__time-range')).toBeVisible();
    await expect(authedPage.getByTestId('overview__quick-access')).toBeVisible();

    await goToProject(authedPage, 'chat');
    await expect(authedPage.getByTestId('chat__new-thread-btn')).toBeVisible();
    await expect(authedPage.getByTestId('chat__threads-pane')).toBeVisible();
    await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
    await expect(authedPage.getByTestId('chat__send-btn')).toBeVisible();

    await goToProject(authedPage, 'workbench');
    await expect(authedPage.getByTestId('workbench__recipe-list')).toBeVisible();
    await expect(authedPage.getByTestId('workbench__create-recipe-btn')).toBeVisible();

    await goToProject(authedPage, 'workbench/recipes/recipe_001');
    await expect(authedPage.getByTestId('workbench__recipe-header')).toBeVisible();
    await expect(authedPage.getByTestId('workbench__conversation-input')).toBeVisible();
    await expect(authedPage.getByTestId('workbench__send-btn')).toBeVisible();

    await goToProject(authedPage, 'sources');
    await expect(authedPage.getByTestId('sources__library-select')).toBeVisible();
    await expect(authedPage.getByTestId('sources__upload-btn')).toBeVisible();
    await expect(authedPage.getByTestId('sources__manage-libraries-btn')).toBeVisible();

    await goToProject(authedPage, 'agents');
    await expect(authedPage.getByTestId('agents__create-btn')).toBeVisible();

    await goToProject(authedPage, 'endpoints');
    await expect(authedPage.getByTestId('endpoints__create-btn')).toBeVisible();

    await goToProject(authedPage, 'credentials');
    await expect(authedPage.getByTestId('credentials__create-btn')).toBeVisible();

    await goToProject(authedPage, 'members');
    await expect(authedPage.getByTestId('members__invite-btn')).toBeVisible();
    await expect(authedPage.getByTestId('members__search-input')).toBeVisible();
    await expect(authedPage.getByTestId('members__role-filter')).toBeVisible();
    await expect(authedPage.getByTestId('members__status-filter')).toBeVisible();

    await goToProject(authedPage, 'resource-policy');
    await expect(authedPage.getByTestId('resource-policy__table')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__editor')).toBeVisible();
    await expect(authedPage.getByTestId('resource-policy__save')).toBeVisible();

    await goToProject(authedPage, 'audit');
    await expect(authedPage.getByTestId('audit__filters')).toBeVisible();

    await goToProject(authedPage, 'usage');
    await expect(authedPage.getByTestId('usage__filters')).toBeVisible();

    await goToProject(authedPage, 'settings');
    await expect(authedPage.getByTestId('settings__tab--general')).toBeVisible();
    await expect(authedPage.getByTestId('settings__tab--runtime')).toBeVisible();
    await expect(authedPage.getByTestId('settings__save-btn')).toBeVisible();
  });

  test('user pages expose primary controls', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);
    await expect(authedPage.getByTestId('profile__display-name')).toBeVisible();
    await expect(authedPage.getByTestId('profile__save-btn')).toBeVisible();

    await goTo(authedPage, `/${LOCALE}/user/api-keys`);
    await expect(authedPage.getByTestId('api-keys__create-btn')).toBeVisible();
    await expect(authedPage.getByTestId('api-keys__table')).toBeVisible();
  });

  test('navigation retains project scope', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
    await authedPage.getByRole('link', { name: /chat/i }).first().click();
    await expect(authedPage).toHaveURL(
      new RegExp(`/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/chat$`)
    );
    await authedPage.getByRole('link', { name: /workbench|ai studio/i }).first().click();
    await expect(authedPage).toHaveURL(
      new RegExp(`/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/workbench$`)
    );
  });
});
