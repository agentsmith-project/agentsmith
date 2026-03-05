import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration (Mock E2E)
 *
 * Default E2E mode: MSW enabled, no real backend required.
 *
 * To run against a manually started server, set:
 * - BASE_URL=http://localhost:3001
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const useManagedDevServer = !process.env.BASE_URL;
/** Local worker count; override with PW_WORKERS (e.g. PW_WORKERS=12). */
const localWorkers = Number(process.env.PW_WORKERS ?? 6);
const isCI = !!process.env.CI;

const webServerCommand = ['bash -lc', JSON.stringify('NEXT_PUBLIC_USE_MSW=true NEXT_PUBLIC_MSW_STRICT_READY=true npm run dev:test -- --port 3001')].join(
  ' ',
);

// MVP release lane: keep chromium gate focused on current product mainline.
// Legacy/archived specs are intentionally excluded from default release gate.
const chromiumMvpSpecMatch = [
  /account\.spec\.ts$/,
  /agents\.spec\.ts$/,
  /audit\.spec\.ts$/,
  /chat\.spec\.ts$/,
  /credentials\.spec\.ts$/,
  /endpoints\.spec\.ts$/,
  /files\.spec\.ts$/,
  /runtime-console\.spec\.ts$/,
];

export default defineConfig({
  testDir: './e2e',
  grepInvert: /@lane-real/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : localWorkers,
  reporter: isCI ? 'html' : 'line',
  timeout: 30000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  webServer: useManagedDevServer
    ? {
        command: webServerCommand,
        url: 'http://localhost:3001',
        reuseExistingServer: true,
        timeout: 120000,
      }
    : undefined,
  use: {
    baseURL,
    trace: isCI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
    video: isCI ? 'retain-on-failure' : 'off',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
    },
    {
      name: 'chromium',
      testMatch: chromiumMvpSpecMatch,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
