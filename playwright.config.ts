import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for MBOS Frontend E2E Testing
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const useManagedDevServer = !process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 2,
  reporter: 'html',
  timeout: 30000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  webServer: useManagedDevServer
    ? {
        command: 'npm run dev:test -- --port 3001',
        url: 'http://localhost:3001',
        reuseExistingServer: true,
        timeout: 120000,
      }
    : undefined,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },

  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: [/smoke\.spec\.ts/, /visual\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
