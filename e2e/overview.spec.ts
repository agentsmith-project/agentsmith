import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Project Hub', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('renders quick links and getting started guidance', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('project-hub__page')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('project-hub__quick-links')).toBeVisible();
    await expect(authedPage.getByTestId('project-hub__getting-started')).toBeVisible();
  });

  test('quick links cover current project surfaces', async ({ authedPage }) => {
    const quickLinks = authedPage.getByTestId('project-hub__quick-links');
    await expect(quickLinks).toBeVisible({ timeout: 10000 });

    await expect(quickLinks.getByRole('link', { name: /chat/i })).toHaveAttribute('href', /\/chat$/);
    await expect(quickLinks.getByRole('link', { name: /notebook/i })).toHaveAttribute('href', /\/notebook$/);
    await expect(quickLinks.getByRole('link', { name: /files/i })).toHaveAttribute('href', /\/files$/);
    await expect(quickLinks.getByRole('link', { name: /endpoints/i })).toHaveAttribute('href', /\/endpoints$/);
    await expect(quickLinks.getByRole('link', { name: /resource policy/i })).toHaveAttribute('href', /\/resource-policy$/);
    await expect(quickLinks.getByRole('link', { name: /usage/i })).toHaveAttribute('href', /\/usage$/);
    await expect(quickLinks.getByRole('link', { name: /audit/i })).toHaveAttribute('href', /\/audit$/);
  });

  test('navigates to usage from project hub quick links', async ({ authedPage }) => {
    const quickLinks = authedPage.getByTestId('project-hub__quick-links');
    await expect(quickLinks).toBeVisible({ timeout: 10000 });

    await quickLinks.getByRole('link', { name: /usage/i }).click();
    await authedPage.waitForURL(/\/usage$/, { timeout: 10000 });
    await expect(authedPage.getByTestId('usage__view')).toBeVisible();
  });
});
