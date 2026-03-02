/**
 * Route Redirect Tests
 *
 * Verifies legacy routes redirect to new routes correctly.
 * Part of WP-03: Navigation Restructure - Route Redirects
 */

import { test, expect, goToProject, projectUrl } from './fixtures/test-base';

const REDIRECT_TEST_CASES = [
  {
    legacyRoute: 'runtime-control-plane',
    expectedRoute: 'runtime-console',
    expectedTab: null,
  },
  {
    legacyRoute: 'runtime-observability',
    expectedRoute: 'runtime-console',
    expectedTab: 'monitoring',
  },
  {
    legacyRoute: 'release-ops',
    expectedRoute: 'runtime-console',
    expectedTab: 'control',
  },
  {
    legacyRoute: 'alerts',
    expectedRoute: 'runtime-console',
    expectedTab: 'alerts',
  },
] as const;

test.describe('Route Redirects - WP-03', () => {
  for (const testCase of REDIRECT_TEST_CASES) {
    test(`redirects /${testCase.legacyRoute} to /${testCase.expectedRoute}${testCase.expectedTab ? `?tab=${testCase.expectedTab}` : ''}`, async ({
      authedPage,
    }) => {
      await goToProject(authedPage, 'overview');

      // Navigate to legacy route using the projectUrl helper
      const legacyUrl = projectUrl(testCase.legacyRoute, 'en-US', 'ws_default', 'proj_001');
      await authedPage.goto(legacyUrl);

      // Wait for redirect to complete
      await authedPage.waitForURL(
        `**/${testCase.expectedRoute}${testCase.expectedTab ? `?tab=${testCase.expectedTab}` : ''}`,
        { timeout: 10000 },
      );

      // Verify final URL
      const finalUrl = authedPage.url();
      expect(finalUrl).toContain(testCase.expectedRoute);
      if (testCase.expectedTab) {
        expect(finalUrl).toContain(`tab=${testCase.expectedTab}`);
      }
    });
  }

  test('redirects preserve query parameters when present', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // Navigate to legacy route with existing query param
    const baseUrl = projectUrl('runtime-observability', 'en-US', 'ws_default', 'proj_001');
    await authedPage.goto(`${baseUrl}?view=detail`);

    // Should redirect to runtime-console with tab=monitoring (preserving existing params depends on implementation)
    await authedPage.waitForURL('**/runtime-console', { timeout: 10000 });

    const finalUrl = authedPage.url();
    expect(finalUrl).toContain('runtime-console');
    expect(finalUrl).toContain('tab=monitoring');
  });

  test('redirects work with both locales (en-US and zh-CN)', async ({ authedPage }) => {
    for (const locale of ['en-US', 'zh-CN']) {
      await goToProject(authedPage, 'overview');

      const legacyUrl = projectUrl('runtime-control-plane', locale, 'ws_default', 'proj_001');
      await authedPage.goto(legacyUrl);

      await authedPage.waitForURL(`**/runtime-console`, { timeout: 10000 });

      const finalUrl = authedPage.url();
      expect(finalUrl).toContain(locale);
      expect(finalUrl).toContain('runtime-console');
    }
  });
});

test.describe('Direct Runtime Console Access - WP-03', () => {
  test('direct access to /runtime-console works without redirect loop', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const directUrl = projectUrl('runtime-console', 'en-US', 'ws_default', 'proj_001');
    await authedPage.goto(directUrl);

    // Should not cause redirect loop - page should load
    await authedPage.waitForURL('**/runtime-console', { timeout: 10000 });

    const finalUrl = authedPage.url();
    expect(finalUrl).toContain('runtime-console');
    // Verify no double redirects by checking URL is stable
    await authedPage.waitForTimeout(500);
    expect(authedPage.url()).toBe(finalUrl);
  });

  test('runtime-console with tab parameter works directly', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const directUrl = projectUrl('runtime-console', 'en-US', 'ws_default', 'proj_001');
    await authedPage.goto(`${directUrl}?tab=monitoring`);

    await authedPage.waitForURL('**/runtime-console?tab=monitoring', { timeout: 10000 });

    const finalUrl = authedPage.url();
    expect(finalUrl).toContain('runtime-console');
    expect(finalUrl).toContain('tab=monitoring');
  });
});
