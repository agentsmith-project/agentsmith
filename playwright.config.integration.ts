import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration (Integration E2E)
 *
 * Runs E2E against a real backend (Keycloak + API).
 * This config only targets `e2e/integration-*.spec.ts`.
 *
 * Defaults:
 * - API base: http://localhost:20000
 * - Frontend: Playwright-managed `next dev` on port 3001
 *
 * Optional overrides:
 * - BASE_URL=http://localhost:3001 (if you start the dev server manually)
 * - INTEGRATION_API_BASE=http://localhost:20000
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const isCI = !!process.env.CI;
const desktopViewport = { width: 1920, height: 1080 };
const desktopWindowArgs = ['--window-size=1920,1080'];

export default defineConfig({
  testDir: './e2e',
  grep: /@lane-real/,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : 1,
  reporter: isCI ? 'html' : 'line',
  timeout: 60000,
  // Integration runs must target already-running frontend/backend services.
  // Playwright-managed service startup is intentionally disabled.
  webServer: undefined,
  use: {
    baseURL,
    trace: isCI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    viewport: desktopViewport,
    launchOptions: {
      args: desktopWindowArgs,
    },
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /integration-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopViewport,
        launchOptions: {
          args: desktopWindowArgs,
        },
      },
    },
  ],
});
