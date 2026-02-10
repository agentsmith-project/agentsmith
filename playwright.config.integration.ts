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
const useManagedDevServer = !process.env.BASE_URL;
const isCI = !!process.env.CI;

const integrationApiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20000';

const webServerCommand = [
  'bash -lc',
  JSON.stringify(
    [
      'NEXT_PUBLIC_USE_MSW=false',
      `NEXT_PUBLIC_API_BASE=${integrationApiBase}`,
      'NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms',
      'NEXT_PUBLIC_KEYCLOAK_REALM=mbos',
      'NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=mbos-frontend',
      'npm run dev:test -- --port 3001',
    ].join(' '),
  ),
].join(' ');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : 1,
  reporter: isCI ? 'html' : 'line',
  timeout: 60000,
  webServer: useManagedDevServer
    ? {
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
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /integration-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
