import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_EMAIL,
  KEYCLOAK_DIRECTORY_CLIENT_ID,
  KEYCLOAK_DIRECTORY_CLIENT_SECRET,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_PUBLISH_STORY = loadStoryDefinitionSync('workspace-publish-to-usable-access');
const WORKSPACE_PUBLISH_BINDING = buildTraceStoryBinding(WORKSPACE_PUBLISH_STORY);
const WORKSPACE_HANDOFF_STORY = loadStoryDefinitionSync('workspace-idp-and-admin-handoff');
const WORKSPACE_HANDOFF_BINDING = buildTraceStoryBinding(WORKSPACE_HANDOFF_STORY);
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';

type WorkspacePublishRuntime = {
  workspaceNamePrefix: string;
  adminEmail: string;
};

type WorkspaceHandoffRuntime = {
  workspaceNamePrefix: string;
  directoryAdminEmail: string;
  pendingAdminEmail: string;
};

function resolveWorkspacePublishStep(stepId: string) {
  const step = WORKSPACE_PUBLISH_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_workspace_publish_step:${stepId}`);
  }
  return step;
}

function resolveWorkspaceHandoffStep(stepId: string) {
  const step = WORKSPACE_HANDOFF_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_workspace_handoff_step:${stepId}`);
  }
  return step;
}

function requireWorkspacePublishRuntime(): WorkspacePublishRuntime {
  const runtimeRoot = WORKSPACE_PUBLISH_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspacePublishUsable as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_publish_runtime_data');
  }
  for (const key of ['workspaceNamePrefix', 'adminEmail'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_workspace_publish_runtime_data:${key}`);
    }
  }
  return runtime as unknown as WorkspacePublishRuntime;
}

function requireWorkspaceHandoffRuntime(): WorkspaceHandoffRuntime {
  const runtimeRoot = WORKSPACE_HANDOFF_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspaceIdpAdminHandoff as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_handoff_runtime_data');
  }
  for (const key of ['workspaceNamePrefix', 'directoryAdminEmail', 'pendingAdminEmail'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_workspace_handoff_runtime_data:${key}`);
    }
  }
  return runtime as unknown as WorkspaceHandoffRuntime;
}

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');
      if (page.url() === 'about:blank') {
        throw new Error('blank_navigation');
      }
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if ((bodyText ?? '').trim().length === 0) {
        throw new Error('empty_document');
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((!message.includes('ERR_ABORTED') && !message.includes('blank_navigation') && !message.includes('empty_document')) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.context().clearCookies();
  await gotoWithRetry(page, `/${LOCALE}/system/login`);
  await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  let loginResponseOk = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes('/api/system/session') && response.request().method() === 'POST',
        { timeout: 5_000 },
      )
      .catch(() => null);
    await page.getByTestId('system-login__submit').click();
    const response = await responsePromise;
    if (response) {
      loginResponseOk = response.ok();
      break;
    }
    await page.waitForTimeout(1_000);
  }
  expect(loginResponseOk).toBe(true);
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
  await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
}

async function waitForWorkspaceId(page: Page, workspaceName: string): Promise<string> {
  await expect
    .poll(
      async () => page.evaluate(async (name) => {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
        return payload.items?.find((item) => item.name === name)?.id ?? null;
      }, workspaceName),
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const resolved = await page.evaluate(async (name) => {
    const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
    const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
    return payload.items?.find((item) => item.name === name)?.id ?? null;
  }, workspaceName);

  if (!resolved) {
    throw new Error('workspace_id_not_found');
  }
  return resolved;
}

async function openCreateWizard(page: Page, workspaceName: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/system/workspaces`);
  await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__new-workspace').click();
  await page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), { timeout: 30_000 });
  await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspaces__draft-idp-url')).toBeVisible({ timeout: 30_000 });
}

async function verifyIdentityProvider(
  page: Page,
  options?: { directorySearchEnabled?: boolean },
): Promise<void> {
  await page.getByTestId('system-workspaces__draft-idp-url').fill(KEYCLOAK_BASE_URL);
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(KEYCLOAK_REALM);
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(KEYCLOAK_WORKSPACE_CLIENT_ID);
  if (options?.directorySearchEnabled) {
    await page.getByTestId('system-workspaces__draft-directory-client-id').fill(KEYCLOAK_DIRECTORY_CLIENT_ID);
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill(KEYCLOAK_DIRECTORY_CLIENT_SECRET);
  }
  const responsePromise = page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByTestId('system-workspace-create__next').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

function getAdminSearchOption(results: Locator, email: string): Locator {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return results.getByRole('button', { name: new RegExp(escaped, 'i') });
}

async function advanceDirectoryBoundReview(page: Page, adminEmail: string): Promise<void> {
  await expect(page.getByTestId('system-workspaces__draft-admin')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('system-workspaces__admin-mode--directory')).toBeEnabled();
  await page.getByTestId('system-workspaces__draft-admin').fill(adminEmail);
  const option = getAdminSearchOption(page.getByTestId('system-workspaces__admin-search-results'), adminEmail);
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspace-create__handoff-state')).toHaveText(/Administrator bound/i, { timeout: 15_000 });
}

async function advanceEmailPendingReview(page: Page, adminEmail: string): Promise<void> {
  await expect(page.getByTestId('system-workspaces__draft-admin-email')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('system-workspaces__admin-mode--directory')).toBeDisabled();
  await page.getByTestId('system-workspaces__draft-admin-email').fill(adminEmail);
  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspace-create__handoff-state')).toHaveText(/Pending admin binding/i, { timeout: 15_000 });
}

async function createAndPublishWorkspace(page: Page, runtime: WorkspacePublishRuntime): Promise<string> {
  const workspaceName = `${runtime.workspaceNamePrefix} ${Date.now()}`;

  await openCreateWizard(page, workspaceName);
  await verifyIdentityProvider(page);
  await page.getByTestId('system-workspaces__admin-mode--email').click();
  await page.getByTestId('system-workspaces__draft-admin-email').fill(runtime.adminEmail);
  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspace-create__handoff-state')).toHaveText(/Pending admin binding/i, { timeout: 15_000 });
  await page.getByTestId('system-workspace-create__create').click();

  const workspaceId = await waitForWorkspaceId(page, workspaceName);
  await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
  await page.getByTestId('system-workspaces__publish').click();

  await expect
    .poll(
      async () => page.evaluate(async (id) => {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as {
          items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
        };
        const item = payload.items?.find((candidate) => candidate.id === id);
        return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
      }, workspaceId),
      { timeout: 30_000 },
    )
    .toMatch(/^ready:/);

  await expect
    .poll(
      async () => page.evaluate(async (id) => {
        const response = await fetch(`/api/public/workspaces/${id}`, { cache: 'no-store' });
        return response.ok ? 'ready' : `status:${response.status}`;
      }, workspaceId),
      { timeout: 30_000 },
    )
    .toBe('ready');

  return workspaceId;
}

test.describe('@lane-real integration workspace publish usable', () => {
  test('published workspace becomes browser and API usable for its admin', async ({ page }) => {
    const runtime = requireWorkspacePublishRuntime();
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-publish-usable',
      storyId: WORKSPACE_PUBLISH_STORY.storyId,
      title: WORKSPACE_PUBLISH_STORY.title,
      actor: WORKSPACE_PUBLISH_STORY.actor,
      route: `/${LOCALE}/system/login`,
      specFile: 'e2e/integration-workspace-publish-usable.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_PUBLISH_STORY.goal,
      preconditions: [...(WORKSPACE_PUBLISH_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_PUBLISH_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_PUBLISH_BINDING,
    });
    const captureTrace = async (pageRef: Page, stepId: string): Promise<void> => {
      const storyStep = resolveWorkspacePublishStep(stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await loginAsSystemAdmin(page);
      await captureTrace(page, 'open-system-login');
      const workspaceId = await createAndPublishWorkspace(page, runtime);
      await captureTrace(page, 'publish-workspace');

      await keycloakLoginToWorkspace(page, workspaceId);
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects(?:$|/)`), {
        timeout: 30_000,
      });
      await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
      await captureTrace(page, 'login-workspace-admin');

      const token = await readStoredAuthToken(page);
      const response = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects?page=1&page_size=20`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.ok()).toBeTruthy();
      await captureTrace(page, 'verify-workspace-usable');
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });

  test('system admin sees the real directory-backed and email-pending admin handoff before publish', async ({ page }) => {
    const runtime = requireWorkspaceHandoffRuntime();
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-publish-usable',
      storyId: WORKSPACE_HANDOFF_STORY.storyId,
      title: WORKSPACE_HANDOFF_STORY.title,
      actor: WORKSPACE_HANDOFF_STORY.actor,
      route: `/${LOCALE}/system/login`,
      specFile: 'e2e/integration-workspace-publish-usable.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_HANDOFF_STORY.goal,
      preconditions: [...(WORKSPACE_HANDOFF_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_HANDOFF_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_HANDOFF_BINDING,
    });
    const captureTrace = async (pageRef: Page, stepId: string): Promise<void> => {
      const storyStep = resolveWorkspaceHandoffStep(stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await loginAsSystemAdmin(page);
      await captureTrace(page, 'open-system-login');

      await openCreateWizard(page, `${runtime.workspaceNamePrefix} Directory ${Date.now()}`);
      await verifyIdentityProvider(page, { directorySearchEnabled: true });
      await advanceDirectoryBoundReview(page, runtime.directoryAdminEmail || KEYCLOAK_DEV_ADMIN_EMAIL);
      await expect(page.getByTestId('system-workspace-create__login-preview')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('system-workspace-create__handoff-body')).toHaveText(/immediately after publish/i);
      await captureTrace(page, 'review-directory-backed-handoff');

      await openCreateWizard(page, `${runtime.workspaceNamePrefix} Pending ${Date.now()}`);
      await verifyIdentityProvider(page, { directorySearchEnabled: false });
      await advanceEmailPendingReview(page, runtime.pendingAdminEmail);
      await expect(page.getByTestId('system-workspace-create__login-preview')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('system-workspace-create__handoff-body')).toHaveText(/first sign-in|首次登录/i);
      await captureTrace(page, 'review-email-pending-handoff');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });
});
