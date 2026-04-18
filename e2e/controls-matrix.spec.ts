import { test, expect, goTo, goToProject, LOCALE, WS_ID, PROJECT_ID } from './fixtures/test-base';

test.describe('Controls Matrix', () => {
  test('workspace pages expose primary controls', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    const createProjectButton = authedPage.getByTestId('projects__create-btn');
    const projectsTable = authedPage.getByTestId('projects__table');
    const permissionDenied = authedPage.getByText(/permission denied/i);
    await expect(
      createProjectButton.or(projectsTable).or(permissionDenied).first()
    ).toBeVisible();

    await goTo(authedPage, `/${LOCALE}/workspaces/${WS_ID}/settings`);
    await expect(
      authedPage
        .getByTestId('ws-settings__workspace')
        .or(permissionDenied)
        .first()
    ).toBeVisible();
  });

  test('project pages expose primary controls', async ({ authedPage }) => {
    test.setTimeout(120000);
    await goToProject(authedPage, 'overview');
    await expect(authedPage.getByTestId('project-overview__page')).toBeVisible();

    await goToProject(authedPage, 'chat');
    await expect(authedPage.getByTestId('chat__new-thread-btn')).toBeVisible();
    await expect(authedPage.getByTestId('chat__threads-pane')).toBeVisible();
    await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
    await expect(authedPage.getByTestId('chat__send-btn')).toBeVisible();

    await goToProject(authedPage, 'notebook');
    await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
    await expect(authedPage.getByTestId('notebook__create-task-btn')).toBeVisible();

    await goToProject(authedPage, 'notebook/tasks/task_001');
    await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible();
    await expect(authedPage.getByTestId('notebook__conversation-input')).toBeVisible();
    await expect(authedPage.getByTestId('notebook__send-btn')).toBeVisible();

    await goToProject(authedPage, 'files');
    await expect(authedPage.getByTestId('files__library-list')).toBeVisible();
    await expect(authedPage.getByTestId('files__upload')).toBeVisible();
    await expect(authedPage.getByTestId('files__new-folder')).toBeVisible();

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
    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    if ((await endpointTabs.count()) > 0) {
      await expect(endpointTabs).toBeVisible();
    }
    await expect(authedPage.getByTestId('usage__selected-endpoint')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();

    await goToProject(authedPage, 'settings');
    await expect(authedPage.getByTestId('settings__general-section')).toBeVisible();
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
    const chatNav = authedPage.getByTestId('sidebar__nav-item--chat');
    const notebookNav = authedPage.getByTestId('sidebar__nav-item--notebook');
    await expect(chatNav).toBeVisible();
    await expect(notebookNav).toBeVisible();

    const expectedChatPath = `/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/chat`;
    const expectedNotebookPath = `/${LOCALE}/workspaces/${WS_ID}/projects/${PROJECT_ID}/notebook`;
    await expect(chatNav).toHaveAttribute('href', expectedChatPath);
    await expect(notebookNav).toHaveAttribute('href', expectedNotebookPath);

    await goToProject(authedPage, 'chat');
    await expect(authedPage).toHaveURL(new RegExp(`${expectedChatPath}$`));
    await goToProject(authedPage, 'notebook');
    await expect(authedPage).toHaveURL(
      new RegExp(`${expectedNotebookPath}$`)
    );
  });
});
