import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Project Hub', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('renders project summary and workspace return link', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('project-hub__page')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('project-hub__back-to-workspace')).toBeVisible();
    await expect(authedPage.getByTestId('project-hub__summary')).toBeVisible();
    await expect(authedPage.getByTestId('project-hub__use-summary')).toBeVisible();
    await expect(authedPage.getByTestId('project-hub__governance-summary')).toBeVisible();
    await expect(authedPage.getByTestId('project-hub__back-to-workspace')).toHaveAttribute(
      'href',
      /\/workspaces\/ws_default$/,
    );
  });

  test('summary chips cover current use and governance surfaces', async ({ authedPage }) => {
    const useSummary = authedPage.getByTestId('project-hub__use-summary');
    const governanceSummary = authedPage.getByTestId('project-hub__governance-summary');
    await expect(useSummary).toBeVisible({ timeout: 10000 });
    await expect(governanceSummary).toBeVisible({ timeout: 10000 });

    await expect(useSummary).toContainText(/chat/i);
    await expect(useSummary).toContainText(/notebook/i);
    await expect(useSummary).toContainText(/files/i);
    await expect(useSummary).toContainText(/usage/i);
    await expect(governanceSummary).toContainText(/endpoints/i);
    await expect(governanceSummary).toContainText(/policy/i);
    await expect(governanceSummary).toContainText(/shared context/i);
    await expect(governanceSummary).toContainText(/project secrets/i);
  });

  test('navigates to usage from sidebar while overview remains summary-only', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('project-hub__use-summary')).toBeVisible({ timeout: 10000 });
    await authedPage.getByTestId('sidebar__nav-item--usage').click();
    await authedPage.waitForURL(/\/usage$/, { timeout: 10000 });
    await expect(authedPage.getByTestId('usage__view')).toBeVisible();
  });
});
