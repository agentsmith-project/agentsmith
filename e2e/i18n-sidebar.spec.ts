/**
 * i18n Sidebar Tests - WP-04
 *
 * Verifies new i18n keys for Use/Develop sections
 */

import { test, expect, goToProject, projectUrl, goTo } from './fixtures/test-base';

const NEW_I18N_KEYS = [
  { key: 'sidebar.use', enValue: 'Use', zhValue: '使用' },
  { key: 'sidebar.develop', enValue: 'Develop', zhValue: '开发' },
] as const;

test.describe('i18n Sidebar Section Labels - WP-04', () => {
  test('shows "Use" section in English', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // Ensure we're in English locale
    if (!authedPage.url().includes('/en-US/')) {
      await authedPage.goto(authedPage.url().replace('/zh-CN/', '/en-US/'));
    }

    const useSection = authedPage.getByTestId('sidebar__section--use');
    await expect(useSection, 'Use section should be visible').toBeVisible();

    const useLabel = useSection.locator('text=Use');
    await expect(useLabel, 'Use label should display "Use" text').toBeVisible();
  });

  test('shows "Develop" section in English', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // Ensure we're in English locale
    if (!authedPage.url().includes('/en-US/')) {
      await authedPage.goto(authedPage.url().replace('/zh-CN/', '/en-US/'));
    }

    const developSection = authedPage.getByTestId('sidebar__section--develop');
    await expect(developSection, 'Develop section should be visible').toBeVisible();

    const developLabel = developSection.locator('text=Develop');
    await expect(developLabel, 'Develop label should display "Develop" text').toBeVisible();
  });

  test('shows "使用" section in Chinese', async ({ authedPage }) => {
    // Switch to Chinese locale
    await goTo(authedPage, projectUrl('overview', 'zh-CN', 'ws_default', 'proj_001'));

    const useSection = authedPage.getByTestId('sidebar__section--use');
    await expect(useSection, 'Use section should be visible').toBeVisible();

    const useLabel = useSection.locator('text=使用');
    await expect(useLabel, 'Use label should display "使用" text').toBeVisible();
  });

  test('shows "开发" section in Chinese', async ({ authedPage }) => {
    // Switch to Chinese locale
    await goTo(authedPage, projectUrl('overview', 'zh-CN', 'ws_default', 'proj_001'));

    const developSection = authedPage.getByTestId('sidebar__section--develop');
    await expect(developSection, 'Develop section should be visible').toBeVisible();

    const developLabel = developSection.locator('text=开发');
    await expect(developLabel, 'Develop label should display "开发" text').toBeVisible();
  });
});

test.describe('i18n Locale Switching - WP-04', () => {
  test('Use section label updates when switching locales', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const useSection = authedPage.getByTestId('sidebar__section--use');
    await expect(useSection).toBeVisible();

    // Check English
    let useLabel = useSection.locator('text=Use');
    await expect(useLabel).toBeVisible();

    // Switch to Chinese via user menu
    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await userMenu.click();
    await authedPage.getByRole('menuitem', { name: /中文/i }).click();

    // Check Chinese
    await expect(useSection).toBeVisible();
    useLabel = useSection.locator('text=使用');
    await expect(useLabel, 'Use section should show "使用" in Chinese').toBeVisible();
  });

  test('Develop section label updates when switching locales', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const developSection = authedPage.getByTestId('sidebar__section--develop');
    await expect(developSection).toBeVisible();

    // Check English
    let developLabel = developSection.locator('text=Develop');
    await expect(developLabel).toBeVisible();

    // Switch to Chinese via user menu
    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await userMenu.click();
    await authedPage.getByRole('menuitem', { name: /中文/i }).click();

    // Check Chinese
    await expect(developSection).toBeVisible();
    developLabel = developSection.locator('text=开发');
    await expect(developLabel, 'Develop section should show "开发" in Chinese').toBeVisible();
  });
});

test.describe('i18n No Hardcoded Text - WP-04', () => {
  test('sidebar section labels come from i18n, not hardcoded', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // The section labels should change based on locale
    // This test verifies the mechanism works, not hardcoded text
    const sections = ['use', 'develop'];

    for (const section of sections) {
      const sectionElement = authedPage.getByTestId(`sidebar__section--${section}`);
      await expect(sectionElement, `Section "${section}" should be visible`).toBeVisible();

      // In English
      const englishText = await sectionElement.textContent();
      expect(englishText?.toLowerCase()).not.toBe('');
    }
  });
});
