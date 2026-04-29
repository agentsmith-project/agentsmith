import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  ensureIntegrationKeycloakUsers,
  keycloakLoginToWorkspace,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  LOCALE,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { readStoryDefinitionFromMarkdownFileSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const DESKTOP_AUTH_STORY = readStoryDefinitionFromMarkdownFileSync(
  path.resolve(process.cwd(), 'e2e/stories/backend-real/desktop-auth-request-complete-and-work.story.md'),
);
const DESKTOP_AUTH_BINDING = buildTraceStoryBinding(DESKTOP_AUTH_STORY);

type DesktopAuthStartResponse = {
  request_id: string;
  browser_start_url: string;
  poll_url: string;
};

type KeycloakTokenResponse = {
  access_token?: string;
};

function requireDesktopAuthDeploymentBaseUrl(): string {
  return process.env.INTEGRATION_BASE_URL?.trim() || 'http://localhost:3001';
}

function requireDesktopAuthKeycloakBaseUrl(): string {
  return process.env.KEYCLOAK_BASE_URL?.trim() || 'http://localhost:18080';
}

async function issueDesktopAuthKeycloakToken(page: Page): Promise<string> {
  const response = await page.request.post(
    `${requireDesktopAuthKeycloakBaseUrl()}/realms/mbos/protocol/openid-connect/token`,
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      form: {
        grant_type: 'password',
        client_id: 'agentsmith',
        username: KEYCLOAK_INTEGRATION_USER_USERNAME,
        password: KEYCLOAK_INTEGRATION_USER_PASSWORD,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as KeycloakTokenResponse;
  if (!body.access_token) {
    throw new Error('desktop_auth_keycloak_access_token_missing');
  }
  return body.access_token;
}

async function completeDesktopAuthKeycloakLogin(page: Page): Promise<void> {
  const workspaceLoginButton = page.getByTestId('workspace-login__keycloak-btn');
  await expect(workspaceLoginButton).toBeVisible({ timeout: 30_000 });
  await expect(workspaceLoginButton).toBeEnabled({ timeout: 30_000 });
  await workspaceLoginButton.click();

  let enteredKeycloakForm = false;
  for (let tick = 0; tick < 60; tick += 1) {
    const currentUrl = page.url();
    if (/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i.test(currentUrl)) {
      enteredKeycloakForm = true;
      break;
    }
    if (currentUrl.includes('/desktop/auth/complete') || currentUrl.includes('/login/workspace')) {
      break;
    }
    await page.waitForTimeout(500);
  }

  if (enteredKeycloakForm) {
    await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(KEYCLOAK_INTEGRATION_USER_USERNAME);
    await page.locator('input#password, input[name="password"]').first().fill(KEYCLOAK_INTEGRATION_USER_PASSWORD);
    await page.locator('#kc-login, button[type="submit"]').first().click();
  }
}

test.describe('@lane-real integration desktop auth request complete and work', () => {
  test('desktop handoff request completes in browser and returns to workspace entry without breaking the work flow', async ({ page }) => {
    test.setTimeout(600_000);
    await ensureIntegrationKeycloakUsers();

    const startResponse = await page.request.post(`${API_BASE}/api/v1/desktop/auth/start`, {
      headers: {
        'content-type': 'application/json',
      },
      data: {
        deployment_base_url: requireDesktopAuthDeploymentBaseUrl(),
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const started = (await startResponse.json()) as DesktopAuthStartResponse;
    expect(started.request_id).toMatch(/^dreq_/);
    expect(started.browser_start_url).toContain('/en-US/desktop/auth/request?desktop_auth_request_id=');

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-desktop-auth-request-complete-and-work',
      storyId: DESKTOP_AUTH_STORY.storyId,
      title: DESKTOP_AUTH_STORY.title,
      actor: DESKTOP_AUTH_STORY.actor,
      route: started.browser_start_url.replace(/^https?:\/\/[^/]+/, ''),
      specFile: 'e2e/integration-desktop-auth-request-complete-and-work.spec.ts',
      browser: 'chromium',
      goal: DESKTOP_AUTH_STORY.goal,
      preconditions: [...(DESKTOP_AUTH_STORY.preconditions ?? [])],
      seedData: [...(DESKTOP_AUTH_STORY.seedData ?? [])],
      storyBinding: DESKTOP_AUTH_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(started.browser_start_url);
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/login/workspace\\?desktop_auth_request_id=${started.request_id}`), {
        timeout: 30_000,
      });
      const workspaceRow = page.getByRole('link', { name: /Default Workspace/i });
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });
      await expect(workspaceRow).toHaveAttribute(
        'href',
        new RegExp(`/${LOCALE}/workspaces/ws_default/login\\?desktop_auth_request_id=${started.request_id}`),
      );
      await trace.capture(page, {
        stepId: 'desktop-auth-request',
        action: 'Review desktop request',
        target: 'desktop-auth-request__title',
        note: 'Desktop request should hand the browser into workspace selection before sign in continues.',
      });
      await workspaceRow.click();
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/ws_default/login\\?desktop_auth_request_id=${started.request_id}`), {
        timeout: 30_000,
      });
      await completeDesktopAuthKeycloakLogin(page);
      const desktopAuthToken = await issueDesktopAuthKeycloakToken(page);
      const requestProbe = await page.request.get(`${API_BASE}/api/v1/desktop/auth/requests/${started.request_id}`);
      expect(requestProbe.ok()).toBeTruthy();

      const completeResponse = await page.request.post(`${API_BASE}/api/v1/me/desktop/auth/requests/${started.request_id}/complete`, {
        headers: {
          authorization: `Bearer ${desktopAuthToken}`,
        },
      });
      expect(completeResponse.ok()).toBeTruthy();

      await page.goto(`/${LOCALE}/desktop/auth/complete?desktop_auth_request_id=${started.request_id}`);
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/desktop/auth/complete\\?desktop_auth_request_id=${started.request_id}`), {
        timeout: 30_000,
      });
      await expect(page.getByTestId('desktop-auth-complete__workspace-entry-link')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'desktop-auth-complete',
        action: 'Review desktop completion',
        target: 'desktop-auth-complete__workspace-entry-link',
        note: 'Completion page should clearly point back to workspace entry so work can continue.',
      });

      await page.getByTestId('desktop-auth-complete__workspace-entry-link').click();
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/login/workspace(?:$|\\?)`), { timeout: 30_000 });
      const returnWorkspaceRow = page.getByRole('link', { name: /Default Workspace/i });
      await expect(returnWorkspaceRow).toBeVisible({ timeout: 30_000 });
      await expect(returnWorkspaceRow).toHaveAttribute('href', `/${LOCALE}/workspaces/ws_default/login`);
      await trace.capture(page, {
        stepId: 'workspace-selection',
        action: 'Continue to workspace sign-in',
        target: 'workspace-select__list',
        note: 'After the desktop handoff, the user should clearly return to workspace selection before entering the workspace again.',
      });

      await returnWorkspaceRow.click();
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/ws_default/login(?:$|\\?)`), { timeout: 30_000 });
      const workspaceLoginButton = page.getByTestId('workspace-login__keycloak-btn');
      await expect(workspaceLoginButton).toBeVisible({ timeout: 30_000 });
      await expect(workspaceLoginButton).toBeEnabled({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'workspace-login',
        action: 'Continue workspace sign-in',
        target: 'workspace-login__keycloak-btn',
        note: 'The workspace sign-in page should be explicit so the user knows the next step before work resumes.',
      });

      await keycloakLoginToWorkspace(page, 'ws_default', undefined, undefined, { preserveCurrentWorkspaceLoginPage: true });
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/ws_default(?:/|$)`), { timeout: 30_000 });
      await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
