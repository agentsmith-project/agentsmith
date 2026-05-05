import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Project Overview', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('renders the current overview structure and workspace return link', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('project-overview__back-to-workspace')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__primary-cta')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__primary-task')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__secondary-steps')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__surface-group--use')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__surface-group--govern')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__surface-group--develop')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__back-to-workspace')).toHaveAttribute(
      'href',
      /\/workspaces\/ws_default$/,
    );
  });

  test('separates next steps from grouped surface summaries', async ({ authedPage }) => {
    const primaryTask = authedPage.getByTestId('project-overview__primary-task');
    const useSummary = authedPage.getByTestId('project-overview__surface-group--use');
    const governanceSummary = authedPage.getByTestId('project-overview__surface-group--govern');
    const developSummary = authedPage.getByTestId('project-overview__surface-group--develop');

    await expect(primaryTask).toBeVisible({ timeout: 10000 });
    await expect(useSummary).toBeVisible({ timeout: 10000 });
    await expect(governanceSummary).toBeVisible({ timeout: 10000 });
    await expect(developSummary).toBeVisible({ timeout: 10000 });

    await expect(primaryTask).toContainText(/chat/i);
    await expect(authedPage.getByTestId('project-overview__secondary-step--agent-tasks')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__secondary-step--files')).toBeVisible();
    await expect(authedPage.getByTestId('project-overview__secondary-step--context')).toBeVisible();
    await expect(useSummary).toContainText(/usage/i);
    await expect(useSummary).toContainText(/access guide/i);
    await expect(governanceSummary).toContainText(/endpoints/i);
    await expect(governanceSummary).toContainText(/policy/i);
    await expect(governanceSummary).toContainText(/project secrets/i);
    await expect(governanceSummary).toContainText(/members/i);
    await expect(governanceSummary).toContainText(/audit/i);
    await expect(governanceSummary).toContainText(/settings/i);
    await expect(developSummary).toContainText(/agent runners/i);
  });

  test('navigates to usage from sidebar while overview remains summary-only', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 10000 });
    await authedPage.getByTestId('sidebar__nav-item--usage').click();
    await authedPage.waitForURL(/\/usage$/, { timeout: 10000 });
    await expect(authedPage.getByTestId('usage__view')).toBeVisible();
  });
});
