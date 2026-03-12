import { test, expect, goTo } from './fixtures/test-base';

const WORKSPACE_OVERVIEW_PATH = '/en-US/workspaces/overview';

test.describe('Workspace Overview', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, WORKSPACE_OVERVIEW_PATH);
  });

  test('renders workspace entry overview', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('workspace-overview__heading')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('workspace-overview__summary')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__list')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__search')).toBeVisible();
  });

  test('shows workspace cards and project entry links', async ({ authedPage }) => {
    const firstCard = authedPage.getByTestId(/workspace-overview__card--/).first();
    await expect(firstCard).toBeVisible();

    const firstOpenProjects = authedPage.getByTestId(/workspace-overview__open-projects--/).first();
    await expect(firstOpenProjects).toBeVisible();
    await expect(firstOpenProjects).toHaveAttribute('href', /\/workspaces\/[^/]+\/projects$/);
  });

  test('supports workspace search', async ({ authedPage }) => {
    const search = authedPage.getByTestId('workspace-overview__search');
    await search.fill('missing-workspace');
    await expect(authedPage.getByTestId('workspace-overview__empty-filtered')).toBeVisible();
  });
});
