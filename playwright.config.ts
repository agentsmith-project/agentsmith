import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for MBOS Frontend E2E Testing
 */
const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const useManagedDevServer = !process.env.BASE_URL;
const localWorkers = Number(process.env.PW_WORKERS ?? 8);
const isCI = !!process.env.CI;
const runIntegrationE2E = process.env.RUN_INTEGRATION_E2E === 'true';
const integrationApiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20000';
const webServerCommand = runIntegrationE2E
  ? [
      'bash -lc',
      JSON.stringify([
        'NEXT_PUBLIC_USE_MSW=false',
        `NEXT_PUBLIC_API_BASE=${integrationApiBase}`,
        'NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms',
        'NEXT_PUBLIC_KEYCLOAK_REALM=mbos',
        'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=mbos-frontend',
        'npm run dev:test -- --port 3001',
      ].join(' ')),
    ].join(' ')
  : ['bash -lc', JSON.stringify('NEXT_PUBLIC_USE_MSW=true npm run dev:test -- --port 3001')].join(' ');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
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
        // Use local next binary directly to avoid npm/npx config arg injection warnings.
        command: webServerCommand,
        url: 'http://localhost:3001',
        reuseExistingServer: false,
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
