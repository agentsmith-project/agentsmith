import { test, expect, goTo, projectUrl, LOCALE, WS_ID, PROJECT_ID } from './fixtures/test-base';

test.describe('Context Store pages', () => {
  test('workspace context page supports create and delete for workspace admins', async ({ authedPage }) => {
    const key = `shared.e2e_workspace_${Date.now()}`;
    await goTo(authedPage, `/${LOCALE}/workspaces/${WS_ID}/settings/context`);

    await expect(authedPage.getByTestId('context-store__list-card')).toBeVisible();
    await authedPage.getByTestId('context-store__new').click();
    await authedPage.getByTestId('context-store__key').fill(key);
    await authedPage.getByTestId('context-store__content').fill('Workspace level guidance');

    const createRequest = authedPage.waitForRequest((request) =>
      request.method() === 'PUT' && /\/api\/v1\/context$/.test(request.url()),
    );
    await authedPage.getByTestId('context-store__save').click();
    const created = await createRequest;
    expect(created.postDataJSON()).toMatchObject({
      scope: 'workspace',
      key,
      workspace_id: WS_ID,
      content: 'Workspace level guidance',
    });

    await expect(authedPage.getByTestId(`context-store__item--${key}`)).toBeVisible();

    const deleteRequest = authedPage.waitForRequest((request) =>
      request.method() === 'DELETE'
      && request.url().includes('/api/v1/context?')
      && request.url().includes(`scope=workspace`)
      && request.url().includes(`key=${encodeURIComponent(key)}`),
    );
    await authedPage.getByTestId('context-store__delete').click();
    await deleteRequest;

    await expect(authedPage.getByTestId(`context-store__item--${key}`)).toHaveCount(0);
  });

  test('project context page supports create and delete for project governance members', async ({ adminPage }) => {
    const key = `shared.e2e_project_${Date.now()}`;
    await goTo(adminPage, projectUrl('context'));

    await expect(adminPage.getByTestId('context-store__editor-card')).toBeVisible();
    await adminPage.getByTestId('context-store__new').click();
    await adminPage.getByTestId('context-store__key').fill(key);
    await adminPage.getByTestId('context-store__content').fill('Project level schema notes');

    const createRequest = adminPage.waitForRequest((request) =>
      request.method() === 'PUT' && /\/api\/v1\/context$/.test(request.url()),
    );
    await adminPage.getByTestId('context-store__save').click();
    const created = await createRequest;
    expect(created.postDataJSON()).toMatchObject({
      scope: 'project',
      key,
      workspace_id: WS_ID,
      project_id: PROJECT_ID,
      content: 'Project level schema notes',
    });

    await expect(adminPage.getByTestId(`context-store__item--${key}`)).toBeVisible();

    const deleteRequest = adminPage.waitForRequest((request) =>
      request.method() === 'DELETE'
      && request.url().includes('/api/v1/context?')
      && request.url().includes('scope=project')
      && request.url().includes(`key=${encodeURIComponent(key)}`),
    );
    await adminPage.getByTestId('context-store__delete').click();
    await deleteRequest;

    await expect(adminPage.getByTestId(`context-store__item--${key}`)).toHaveCount(0);
  });

  test('limited members cannot edit workspace or project shared context pages', async ({ limitedPage }) => {
    await goTo(limitedPage, `/${LOCALE}/workspaces/${WS_ID}/settings/context`);
    await expect(limitedPage.getByRole('heading', { name: /permission denied/i })).toBeVisible();

    await goTo(limitedPage, projectUrl('context'));
    await expect(limitedPage.getByRole('heading', { name: /permission denied/i })).toBeVisible();
  });
});
