import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:3060';
const desktopViewport = { width: 1920, height: 1080 };
const desktopWindowArgs = ['--window-size=1920,1080'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  timeout: 30_000,
  webServer: undefined,
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    viewport: desktopViewport,
    launchOptions: {
      args: desktopWindowArgs,
    },
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /workspace-settings\.spec\.ts$/,
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
