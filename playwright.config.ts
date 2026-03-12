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
const desktopViewport = { width: 1920, height: 1080 };
const desktopWindowArgs = ['--window-size=1920,1080'];

const webServerCommand = ['bash -lc', JSON.stringify('NEXT_PUBLIC_USE_MSW=true NEXT_PUBLIC_MSW_STRICT_READY=true npm run dev:test -- --port 3001')].join(
  ' ',
);

// MVP engineering lane: keep chromium gate focused on current product mainline.
// Legacy/archived specs are intentionally excluded from default engineering gate.
const chromiumMvpSpecMatch = [
  /account\.spec\.ts$/,
  /agents\.spec\.ts$/,
  /audit\.spec\.ts$/,
  /chat\.spec\.ts$/,
  /credentials\.spec\.ts$/,
  /endpoints\.spec\.ts$/,
  /files\.spec\.ts$/,
  /login\.spec\.ts$/,
  /system-admin\.spec\.ts$/,
  /workspace-overview\.spec\.ts$/,
  /usage\.spec\.ts$/,
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
    viewport: desktopViewport,
    launchOptions: {
      args: desktopWindowArgs,
    },
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopViewport,
        launchOptions: {
          args: desktopWindowArgs,
        },
      },
      fullyParallel: false,
    },
    {
      name: 'chromium',
      testMatch: chromiumMvpSpecMatch,
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopViewport,
        launchOptions: {
          args: desktopWindowArgs,
        },
      },
    },
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopViewport,
        launchOptions: {
          args: desktopWindowArgs,
        },
      },
      fullyParallel: false,
      workers: 1,
    },
  ],
});
