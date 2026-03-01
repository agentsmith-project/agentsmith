/**
 * Navigation Tests
 *
 * Verifies sidebar navigation, topbar components, workspace/project switchers,
 * and user menu interactions.
 */

import { test, expect, goToProject } from './fixtures/test-base';

const SIDEBAR_NAV_ITEMS = [
  'overview',
  'chat',
  'notebook',
  'resource_policy',
  'agents',
  'endpoints',
  'members',
  'files',
  'audit',
  'usage',
  'release_ops',
  'settings',
] as const;

const SIDEBAR_SECTIONS = ['home', 'build', 'govern', 'operate'] as const;

test.describe('Sidebar', () => {
  test('renders with all nav items', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const sidebar = authedPage.getByTestId('sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    for (const section of SIDEBAR_SECTIONS) {
      const sectionHeading = authedPage.getByTestId(`sidebar__section--${section}`);
      await expect(sectionHeading, `Sidebar section "${section}" should be visible`).toBeVisible();
    }

    for (const name of SIDEBAR_NAV_ITEMS) {
      const navItem = authedPage.getByTestId(`sidebar__nav-item--${name}`);
      await expect(navItem, `Sidebar nav item "${name}" should be visible`).toBeVisible();
    }
  });

  test('navigation changes URL on click', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const sidebar = authedPage.getByTestId('sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const sectionsToTest = ['chat', 'resource_policy', 'agents', 'members', 'release_ops', 'settings'] as const;

    for (const section of sectionsToTest) {
      const navItem = authedPage.getByTestId(`sidebar__nav-item--${section}`);
      await navItem.click();
      const expectedPath = section === 'resource_policy'
        ? '/resource-policy'
        : section === 'release_ops'
          ? '/release-ops'
          : `/${section}`;
      await authedPage.waitForURL(`**${expectedPath}`, { timeout: 10000 });
      expect(authedPage.url()).toContain(expectedPath);
    }
  });

  test('collapse button toggles sidebar', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const sidebar = authedPage.getByTestId('sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const collapseBtn = authedPage.getByTestId('sidebar__collapse-btn');
    await expect(collapseBtn).toBeVisible();

    // Get initial width before collapsing
    const initialWidth = await sidebar.evaluate((el) =>
      Math.round(el.getBoundingClientRect().width),
    );

    // Click collapse — sidebar should collapse (reduce width, hide labels, or add class)
    await collapseBtn.click({ force: true });
    await authedPage.waitForTimeout(500);

    // Verify the sidebar changed state (width reduced or data-collapsed attribute set)
    const collapsedWidth = await sidebar.evaluate((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    const hasCollapsedAttr = await sidebar.evaluate((el) =>
      el.hasAttribute('data-collapsed') || el.classList.contains('collapsed') ||
      el.getAttribute('data-state') === 'collapsed',
    );
    expect(
      collapsedWidth < initialWidth || hasCollapsedAttr,
      'Sidebar should be collapsed (reduced width or collapsed attribute)',
    ).toBeTruthy();

    // Click again to expand
    await collapseBtn.click({ force: true });
    await authedPage.waitForTimeout(500);

    const expandedWidth = await sidebar.evaluate((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    expect(expandedWidth).toBeGreaterThanOrEqual(collapsedWidth);
  });
});

test.describe('Topbar', () => {
  test('renders with workspace switcher and user menu', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const topbar = authedPage.getByTestId('topbar');
    await expect(topbar).toBeVisible({ timeout: 10000 });

    await expect(authedPage.getByTestId('topbar__workspace-switcher')).toBeVisible();
    await expect(authedPage.getByTestId('topbar__user-menu')).toBeVisible();
  });

  test('workspace switcher opens dropdown', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const switcher = authedPage.getByTestId('topbar__workspace-switcher');
    await expect(switcher).toBeVisible({ timeout: 10000 });
    await switcher.click();

    // A dropdown or popover with workspace options should appear
    await expect(
      authedPage
        .locator('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]')
        .first(),
    ).toBeVisible();
  });

  test('project switcher is visible', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const projectSwitcher = authedPage.getByTestId('topbar__project-switcher');
    await expect(projectSwitcher).toBeVisible({ timeout: 10000 });
  });
});

test.describe('User Menu', () => {
  test('opens with expected menu items', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenuTrigger = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenuTrigger).toBeVisible({ timeout: 10000 });
    await userMenuTrigger.click();

    await expect(authedPage.getByTestId('user-menu__profile')).toBeVisible();
    await expect(authedPage.getByTestId('user-menu__api-keys')).toBeVisible();
    await expect(authedPage.getByTestId('user-menu__language').first()).toBeVisible();
    await expect(authedPage.getByTestId('user-menu__logout')).toBeVisible();
  });

  test('navigate to profile via menu', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();
    await authedPage.getByTestId('user-menu__profile').click();

    await authedPage.waitForURL('**/user/profile', { timeout: 10000 });
    expect(authedPage.url()).toContain('/user/profile');
  });

  test('navigate to api-keys via menu', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();
    await authedPage.getByTestId('user-menu__api-keys').click();

    await authedPage.waitForURL('**/user/api-keys', { timeout: 10000 });
    expect(authedPage.url()).toContain('/user/api-keys');
  });

  test('language menu includes English and Chinese options', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    await expect(authedPage.getByRole('menuitem', { name: /English/i })).toBeVisible();
    await expect(authedPage.getByRole('menuitem', { name: /中文/i })).toBeVisible();
  });

  test('logout navigates to login page', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();
    await authedPage.getByTestId('user-menu__logout').click();

    await authedPage.waitForURL('**/login', { timeout: 10000 });
    expect(authedPage.url()).toContain('/login');
  });
});
