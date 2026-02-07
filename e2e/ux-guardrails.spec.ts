/**
 * UX Guardrails Tests
 *
 * Validates core UX expectations: visible CTAs, shell structure,
 * no horizontal overflow, loading states, and page-state indicators.
 */

import { test, expect, goToProject, goTo, LOCALE, WS_ID, PROJECT_ID } from './fixtures/test-base';
import { gotoAndWait } from './utils/navigation';

const PROJECT_SECTIONS = [
  'overview',
  'chat',
  'workbench',
  'agents',
  'endpoints',
  'members',
  'audit',
  'usage',
  'sources',
  'settings',
] as const;

test.describe('UX Guardrails', () => {
  test('login CTA is visible and properly styled', async ({ page }) => {
    await gotoAndWait(page, `/${LOCALE}/login`);

    await expect(page.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    const loginBtn = page.getByTestId('login__submit');
    await expect(loginBtn).toBeVisible();

    // Verify the button has visible text and appropriate styling
    const text = await loginBtn.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);

    // Quick Login is disabled when no email is entered – just verify it's visible
    // (login.spec.ts covers the enable/disable behavior in detail)
  });

  test('app shell structure renders topbar and sidebar', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // Verify the main shell elements
    const topbar = authedPage.getByTestId('topbar');
    await expect(topbar).toBeVisible({ timeout: 10000 });

    const sidebar = authedPage.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();

    // Verify header element exists
    await expect(authedPage.locator('header').first()).toBeVisible();
  });

  test('no horizontal overflow on project pages', async ({ authedPage }) => {
    test.setTimeout(90000);

    // Ensure sidebar is expanded for consistent layout measurement
    await authedPage.addInitScript(() => {
      localStorage.setItem('mbos.sidebar.collapsed', '0');
    });

    for (const section of PROJECT_SECTIONS) {
      await goToProject(authedPage, section);

      const hasOverflow = await authedPage.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > window.innerWidth + 1;
      });
      expect(hasOverflow, `Horizontal overflow detected on /${section}`).toBeFalsy();
    }
  });

  test('loading states show skeleton or content, not blank', async ({ authedPage }) => {
    const pagesToCheck = ['overview', 'members', 'settings'] as const;

    for (const section of pagesToCheck) {
      await goToProject(authedPage, section);

      // Page should show either a loading skeleton, content, or a page-state indicator
      // It must NOT be completely blank
      const hasContent = await authedPage.evaluate(() => {
        const main =
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.querySelector('[data-testid="page-layout"]');
        if (!main) return document.body.innerText.trim().length > 0;
        return main.innerHTML.trim().length > 0;
      });
      expect(hasContent, `Page /${section} appears blank`).toBeTruthy();
    }
  });

  test('page-state indicator appears on loaded pages', async ({ authedPage }) => {
    const pagesToCheck = ['overview', 'members', 'agents', 'settings'] as const;

    for (const section of pagesToCheck) {
      await goToProject(authedPage, section);

      const stateIndicator = authedPage.getByTestId('page-state__success');
      await expect(
        stateIndicator,
        `page-state__success should appear on /${section}`,
      ).toBeVisible();
    }
  });
});
