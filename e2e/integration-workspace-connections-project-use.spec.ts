import { expect, test, type Page } from '@playwright/test';
import {
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  keycloakLoginToWorkspace,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  LOCALE,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_CONNECTIONS_STORY = loadStoryDefinitionSync('workspace-connections-to-project-use');
const WORKSPACE_CONNECTIONS_BINDING = buildTraceStoryBinding(WORKSPACE_CONNECTIONS_STORY);

type WorkspaceConnectionsRuntime = {
  projectNamePrefix: string;
  endpointNamePrefix: string;
  credentialNamePrefix: string;
  connectionDisplayNamePrefix: string;
  connectionCustomDomainSuffix: string;
  connectionToken: string;
  connectionNote: string;
  model: string;
};

function requireWorkspaceConnectionsRuntime(): WorkspaceConnectionsRuntime {
  const runtimeRoot = WORKSPACE_CONNECTIONS_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspaceConnectionsToProjectUse as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_connections_to_project_use_runtime_data');
  }
  for (const key of [
    'projectNamePrefix',
    'endpointNamePrefix',
    'credentialNamePrefix',
    'connectionDisplayNamePrefix',
    'connectionCustomDomainSuffix',
    'connectionToken',
    'connectionNote',
    'model',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_workspace_connections_to_project_use_runtime_data:${key}`);
    }
  }
  return runtime as unknown as WorkspaceConnectionsRuntime;
}

async function createPersonalConnection(
  page: Page,
  input: { displayName: string; customDomain: string; note: string; token: string },
): Promise<void> {
  await page.goto(`/${LOCALE}/user/third-party-accounts`);
  await expect(page.getByTestId('third-party-accounts__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('third-party-accounts__create-btn').click();
  const sheet = page.getByTestId('third-party-accounts__sheet');
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await sheet.getByTestId('third-party-accounts__provider-select').selectOption('custom');
  await expect(sheet.getByTestId('third-party-accounts__custom-domain')).toBeVisible({ timeout: 10_000 });
  await sheet.getByTestId('third-party-accounts__custom-domain').fill(input.customDomain);
  await sheet.getByTestId('third-party-accounts__display-name').fill(input.displayName);
  await sheet.getByTestId('third-party-accounts__note').fill(input.note);
  const baseUrlSecretToggle = sheet.getByTestId('third-party-accounts__field-secret-0');
  if (await baseUrlSecretToggle.isChecked()) {
    await baseUrlSecretToggle.uncheck();
  }
  await sheet.getByTestId('third-party-accounts__field-key-0').fill('base_url');
  await sheet.getByTestId('third-party-accounts__field-value-0').fill(`https://${input.customDomain}`);
  await sheet.getByTestId('third-party-accounts__field-description-0').fill('Base URL');
  await sheet.getByTestId('third-party-accounts__add-field').click();
  await sheet.getByTestId('third-party-accounts__field-key-1').fill('token');
  await sheet.getByTestId('third-party-accounts__field-value-1').fill(input.token);
  await sheet.getByTestId('third-party-accounts__field-description-1').fill('Access token');
  const createResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST' && res.url().endsWith('/api/v1/me/external-connections'),
  );
  await sheet.getByTestId('third-party-accounts__submit-btn').click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByText(input.displayName)).toBeVisible({ timeout: 30_000 });
}

async function createProjectAndEndpoint(page: Page, runtime: WorkspaceConnectionsRuntime): Promise<{ workspaceId: string; projectId: string; endpointName: string }> {
  const workspaceId = 'ws_default';
  const projectName = `${runtime.projectNamePrefix} ${Date.now()}`;
  await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
  const { projectId } = await createProjectInWorkspace(page, workspaceId, projectName, {
    visibility: 'public',
    joinPolicy: 'open',
  });
  const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
  const endpointName = `${runtime.endpointNamePrefix} ${Date.now()}`;
  await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'gateway-upstream-test-key');
  await createEndpointViaApi(page, workspaceId, projectId, {
    endpointName,
    endpointModel: runtime.model,
    upstreamBaseUrl: 'https://story-workspace-connections.example/v1',
    credentialName,
    upstreamProtocol: 'anthropic_messages',
  });
  return { workspaceId, projectId, endpointName };
}

test.describe('@lane-real integration workspace connections project use', () => {
  test('workspace connections gives a clear handoff into first project use-guide consumption', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requireWorkspaceConnectionsRuntime();
    await ensureIntegrationKeycloakUsers();
    const { workspaceId, projectId, endpointName } = await createProjectAndEndpoint(page, runtime);

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-connections-project-use',
      storyId: WORKSPACE_CONNECTIONS_STORY.storyId,
      title: WORKSPACE_CONNECTIONS_STORY.title,
      actor: WORKSPACE_CONNECTIONS_STORY.actor,
      route: `/${LOCALE}/workspaces/${workspaceId}/connections`,
      specFile: 'e2e/integration-workspace-connections-project-use.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_CONNECTIONS_STORY.goal,
      preconditions: [...(WORKSPACE_CONNECTIONS_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_CONNECTIONS_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_CONNECTIONS_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/connections`);
      await expect(page.getByTestId('workspace-connections__feishu-connect')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'review-workspace-connections',
        action: 'Review workspace connections',
        target: 'workspace-connections__next-step',
        note: '工作区连接页必须清楚告诉用户下一步可以进入项目使用，而不是停在连接状态上。',
      });

      await page.goto(`/${LOCALE}/user/third-party-accounts`);
      await createPersonalConnection(page, {
        displayName: `${runtime.connectionDisplayNamePrefix} ${Date.now()}`,
        customDomain: `${Date.now()}.${runtime.connectionCustomDomainSuffix}`,
        note: runtime.connectionNote,
        token: runtime.connectionToken,
      });
      await trace.capture(page, {
        stepId: 'create-or-refresh-personal-connection',
        action: 'Create or refresh personal connection',
        target: 'third-party-accounts__create-btn',
        note: '个人连接页应保留创建入口并清晰反映新连接已经保存。',
      });

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/use-guide`);
      await expect(page.getByTestId('use-guide__page')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('use-guide__endpoint-select').click();
      await page.getByRole('option', { name: endpointName }).click();
      await expect(page.getByTestId('use-guide__gateway-base-url')).toContainText(
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/`,
      );
      await trace.capture(page, {
        stepId: 'open-project-use-guide',
        action: 'Open project use guide',
        target: 'use-guide__page',
        note: 'use-guide 应该承接成员进入项目后的第一次消费入口。',
      });
      await trace.capture(page, {
        stepId: 'verify-project-use-ready',
        action: 'Verify project use ready',
        target: 'use-guide__endpoint-select',
        note: '用户应能从连接页顺滑进入 use-guide，并看到可消费的 endpoint。',
      });
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
